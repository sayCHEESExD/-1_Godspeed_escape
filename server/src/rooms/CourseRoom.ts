import { Client, Room, ServerError } from '@colyseus/core';
import {
  PlayerAnimationState,
  DEATH_HOLD_SECONDS,
  DEATH_PLACE_MARGIN,
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  SPRINT,
  accountKeyFor,
  createMotion,
  isAccountKey,
  isValidGuestId,
  sanitizeAppearance,
  sanitizeIdentity,
  sanitizeProportions,
  type AuthStateMessage,
  type AuthStatus,
  type BuyCharmMessage,
  type CharmMessage,
  type ClaimStageMessage,
  type MoveMessage,
  type PlayerMotion,
  type RespawnMessage,
  type RespawnReason,
  type SetAuthMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
  type SlotMessage,
  type StageAwardedMessage,
  type UnlockUpgradeMessage,
} from '@godspeed/shared';
import { tokenHash, verifyGameToken } from '../auth/BloxityAuth.js';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { hasProgress, progressOf, type ProfileFields, type StoredProfile } from '../persistence/index.js';
import { AuraService } from '../progression/AuraService.js';
import { buxGrants } from '../progression/BuxGrants.js';
import { CharmService } from '../progression/CharmService.js';
import { leaderboardService } from '../progression/LeaderboardService.js';
import { profileStore } from '../progression/ProfileStore.js';
import { RebirthService } from '../progression/RebirthService.js';
import { SpeedService } from '../progression/SpeedService.js';
import { StageService } from '../progression/StageService.js';
import { TrailService } from '../progression/TrailService.js';
import { UpgradeService } from '../progression/UpgradeService.js';
import { wallet } from '../progression/Wallet.js';
import { logger } from '../util/logger.js';
import { CourseState } from './state/CourseState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'CourseRoom';

/** Seconds between autosaves of every connected player. */
const AUTOSAVE_SECONDS = 15;
/** Milliseconds between looks for purchases waiting on an account. */
const GRANT_POLL_MS = 15_000;
/** Re-verification backoff for a token Bloxity could not be asked about. */
const REVERIFY_FIRST_MS = 15_000;
const REVERIFY_MAX_MS = 120_000;
/** How long a mid-session switch waits for the leaving profile to land before staying put. */
const SWITCH_SAVE_TIMEOUT_MS = 8000;
/**
 * How long a leave or a dispose waits for its save to land before moving on.
 * The save is QUEUED either way and lands when storage is back; what must not
 * happen is a socket held open, or a room kept alive, for as long as an
 * outage lasts.
 */
const LEAVE_SAVE_TIMEOUT_MS = 5000;
/** Longest token accepted. Bloxity's are a few hundred bytes. */
const MAX_TOKEN_LENGTH = 4096;

/** Join refusals. The client's retry/backoff recognises STORAGE_UNAVAILABLE. */
export const JOIN_ERROR = {
  ROOM_FULL: 4103,
  BAD_PLAYER_ID: 4104,
  STORAGE_UNAVAILABLE: 4105,
} as const;

interface JoinOptions {
  /** The browser's own guest id. NEVER an account id; the prefix is refused. */
  playerId?: string;
  /** The portal's game token, or nothing. Verified with Bloxity, never trusted. */
  token?: string | null;
  avatar?: SetAvatarMessage;
  identity?: SetIdentityMessage;
}

/** What `onAuth` resolves and hands to `onJoin`. */
interface ResolvedProfile {
  /** The key this session plays on. Empty only for a client that sent no id at all. */
  readonly key: string;
  readonly guestKey: string;
  readonly accountKey: string | null;
  readonly token: string | null;
  readonly tokenHash: string;
  readonly status: AuthStatus;
  readonly profile: StoredProfile | null;
  /** True when this resolution migrated a guest's progress into the account. */
  readonly migrated: boolean;
}

/** Per-session bookkeeping the replicated state must not carry. */
interface Session {
  key: string;
  guestKey: string;
  accountKey: string | null;
  token: string | null;
  tokenHash: string;
  status: AuthStatus;
  /** True while a login change is being applied: autosaves and grants hold off. */
  switching: boolean;
  /** A login that arrived mid-switch. Only the newest counts. */
  queued: SetAuthMessage | null;
  /** True while grants are being claimed and paid, so two polls never overlap. */
  granting: boolean;
  reverifyAt: number;
  reverifyDelay: number;
  grantPollAt: number;
}

/**
 * The authoritative room.
 *
 * Composition only: every rule lives in a service, and this decides the order
 * they run in. What it owns outright is the CLOCK. The one hard rule: nothing
 * a client sends is ever copied into state. A Move is simulated, a claim is
 * validated, and both produce a result the server writes itself.
 *
 * WHOSE PROGRESS A SESSION PLAYS ON is decided here too, and by the same
 * rule: the client sends its browser id and the portal's TOKEN, Bloxity is
 * asked whose token it is, and the profile is READ FROM STORAGE in `onAuth`.
 * A read that fails refuses the join - a player is never seated on an empty
 * profile that would autosave over their real one. A login that changes
 * mid-session is a message on the live session, never a reconnect.
 */
export class CourseRoom extends Room<CourseState> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override autoDispose = true;

  private readonly movement = new MovementService();
  private readonly speeds = new SpeedService();
  private readonly stages = new StageService();
  private readonly upgrades = new UpgradeService();
  private readonly rebirths = new RebirthService();
  private readonly trails = new TrailService();
  private readonly auras = new AuraService();
  private readonly charms = new CharmService();

  /** Session id -> the profile key it currently plays on. The boards read it. */
  private readonly playerIds = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private readonly scratch: PlayerMotion = createMotion();
  private readonly dying = new Map<string, { remaining: number; reason: RespawnReason }>();

  private autosaveTimer = 0;

  override onCreate(): void {
    this.state = new CourseState();
    this.setPatchRate(serverConfig.patchRateMs);

    this.onMessage(MessageType.Move, (client, message: MoveMessage) => this.onMove(client, message));
    this.onMessage(MessageType.ClaimStage, (client, message: ClaimStageMessage) =>
      this.onClaimStage(client, message),
    );
    this.onMessage(MessageType.RequestRespawn, (client) => this.respawn(client, 'manual'));
    this.onMessage(MessageType.Rebirth, (client) => this.onRebirth(client));
    this.onMessage(MessageType.UnlockUpgrade, (client, message: UnlockUpgradeMessage) =>
      this.onUnlockUpgrade(client, message),
    );
    this.onMessage(MessageType.UnlockTrail, (client, message: SlotMessage) =>
      this.onUnlockTrail(client, message),
    );
    this.onMessage(MessageType.EquipTrail, (client, message: SlotMessage) =>
      this.onEquipTrail(client, message),
    );
    this.onMessage(MessageType.UnlockAura, (client, message: SlotMessage) =>
      this.onUnlockAura(client, message),
    );
    this.onMessage(MessageType.EquipAura, (client, message: SlotMessage) =>
      this.onEquipAura(client, message),
    );
    this.onMessage(MessageType.BuyCharm, (client, message: BuyCharmMessage) =>
      this.onBuyCharm(client, message),
    );
    this.onMessage(MessageType.EquipCharm, (client, message: CharmMessage) =>
      this.onEquipCharm(client, message, true),
    );
    this.onMessage(MessageType.UnequipCharm, (client, message: CharmMessage) =>
      this.onEquipCharm(client, message, false),
    );
    this.onMessage(MessageType.SetIdentity, (client, message: SetIdentityMessage) =>
      this.onSetIdentity(client, message),
    );
    this.onMessage(MessageType.SetAvatar, (client, message: SetAvatarMessage) =>
      this.onSetAvatar(client, message),
    );
    this.onMessage(MessageType.SetAuth, (client, message: SetAuthMessage) => {
      void this.switchAuth(client, message, false);
    });

    this.charms.publish(this.state.shop);

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), serverConfig.patchRateMs);

    logger.info(SCOPE, `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`);
  }

  /**
   * Capacity, identity and the profile READ, before the seat is taken.
   *
   * Colyseus hands whatever this resolves to `onJoin`. A thrown ServerError
   * refuses the join with its code, which is how a storage outage is turned
   * into "try again shortly" on the client rather than an empty profile.
   */
  override async onAuth(client: Client, options: JoinOptions = {}): Promise<ResolvedProfile> {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) {
      logger.warn(
        SCOPE,
        `refused a join: room ${this.roomId} is full (${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`,
      );
      throw new ServerError(JOIN_ERROR.ROOM_FULL, 'room is full');
    }

    const guestKey = readGuestKey(options.playerId);
    const token = readToken(options.token);
    try {
      return await this.resolveProfile(guestKey, token, null);
    } catch (error) {
      logger.error(SCOPE, `refused a join: storage unreachable for ${client.sessionId}:`, error);
      throw new ServerError(JOIN_ERROR.STORAGE_UNAVAILABLE, 'storage unavailable, try again shortly');
    }
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: ResolvedProfile): void {
    const resolved: ResolvedProfile = auth ?? {
      key: '',
      guestKey: '',
      accountKey: null,
      token: null,
      tokenHash: '',
      status: 'guest',
      profile: null,
      migrated: false,
    };

    const player = new PlayerState();
    player.sessionId = client.sessionId;

    const now = Date.now();
    this.sessions.set(client.sessionId, {
      key: resolved.key,
      guestKey: resolved.guestKey,
      accountKey: resolved.accountKey,
      token: resolved.token,
      tokenHash: resolved.tokenHash,
      status: resolved.status,
      switching: false,
      queued: null,
      granting: false,
      reverifyAt: now + REVERIFY_FIRST_MS,
      reverifyDelay: REVERIFY_FIRST_MS,
      grantPollAt: now + GRANT_POLL_MS,
    });
    if (resolved.key) this.playerIds.set(client.sessionId, resolved.key);

    // Restore BEFORE any service initialises: everything derived is derived
    // from the restored figures.
    profileStore.applyTo(player, resolved.profile);

    this.state.players.set(client.sessionId, player);
    this.initialiseServices(client.sessionId, player);

    if (options.avatar) this.writeAvatar(player, options.avatar);
    if (options.identity) {
      const identity = sanitizeIdentity(options.identity);
      if (identity.displayName) {
        player.displayName = identity.displayName;
        player.avatarUrl = identity.avatarUrl;
      }
    }

    if (resolved.profile) this.speeds.syncDerived(player);

    this.placeAt(client, player, 'join');
    this.sendAuthState(client, resolved.status);
    if (resolved.accountKey) void this.applyGrants(client.sessionId);

    logger.info(
      SCOPE,
      `join ${client.sessionId} as ${describe(resolved)} (${resolved.profile ? 'restored' : 'new'}) ` +
        `level=${player.level} wins=${player.wins} upgrade=${player.upgradeSlot}`,
    );
  }

  override async onLeave(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    const key = session?.key;

    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.speeds.forget(client.sessionId);
    this.stages.forget(client.sessionId);
    this.upgrades.forget(client.sessionId);
    this.trails.forget(client.sessionId);
    this.auras.forget(client.sessionId);
    this.charms.forget(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.playerIds.delete(client.sessionId);
    this.dying.delete(client.sessionId);

    logger.info(SCOPE, `leave ${client.sessionId}`);
    if (player && key) await this.saveBounded(key, player);
  }

  override async onDispose(): Promise<void> {
    const saves: Promise<void>[] = [];
    for (const [sessionId, player] of this.state.players) {
      const key = this.sessions.get(sessionId)?.key;
      if (key) saves.push(this.saveBounded(key, player));
    }
    await Promise.all(saves);
    logger.info(SCOPE, `room ${this.roomId} disposed`);
  }

  // ------------------------------------------------------------- identity

  /**
   * WHOSE PROFILE, and the profile itself, read from storage now.
   *
   * With a token, Bloxity is asked. Verified -> the account key; the
   * account's own profile always wins. If the account has none and this
   * browser's guest has real progress, the guest's progress becomes the
   * account's - insert-only, so two pods racing for the same first login
   * create one profile and the loser loads the winner - and the guest is then
   * retired. `live` is the guest's LIVE session when this happens mid-session,
   * because it is newer than the last autosave.
   *
   * Rejected -> a guest. Unavailable -> a guest FOR NOW, token kept, re-asked
   * on a backoff.
   *
   * Throws when storage cannot be read. Callers refuse or stay put.
   */
  private async resolveProfile(
    guestKey: string,
    token: string | null,
    live: ProfileFields | null,
  ): Promise<ResolvedProfile> {
    let status: AuthStatus = 'guest';
    let accountKey: string | null = null;
    const hash = token ? tokenHash(token) : '';
    if (token) {
      const outcome = await verifyGameToken(token);
      if (outcome.status === 'verified') {
        accountKey = accountKeyFor(outcome.accountId);
        status = 'account';
      } else if (outcome.status === 'unavailable') {
        status = 'unavailable';
      }
    }

    if (accountKey) {
      let profile = await profileStore.load(accountKey);
      let migrated = false;
      if (!profile && guestKey) {
        const guest = await profileStore.load(guestKey);
        const retired = Boolean(guest?.migratedTo);
        const source: ProfileFields | null =
          live ??
          (guest
            ? {
                ...progressOf(guest),
                displayName: guest.displayName,
                avatarUrl: guest.avatarUrl,
                updatedAt: guest.updatedAt,
              }
            : null);
        if (!retired && source && hasProgress(source)) {
          const created = { ...source, updatedAt: Date.now(), migratedFrom: guestKey };
          if (await profileStore.insertIfAbsent(accountKey, created)) {
            // Only AFTER the account holds it is the guest copy retired. A
            // crash between the two duplicates progress; it never loses it.
            await profileStore.retireGuest(guestKey, accountKey, progressOf(source), {
              displayName: source.displayName,
              avatarUrl: source.avatarUrl,
            });
            profile = created;
            migrated = true;
            logger.info(SCOPE, `migrated guest ${guestKey} into ${accountKey} (wins=${source.wins})`);
          } else {
            logger.info(SCOPE, `lost the first-login race for ${accountKey}; loading the winner`);
            profile = await profileStore.load(accountKey);
          }
        }
      }
      return { key: accountKey, guestKey, accountKey, token, tokenHash: hash, status, profile, migrated };
    }

    const profile = guestKey ? await profileStore.load(guestKey) : null;
    return { key: guestKey, guestKey, accountKey: null, token, tokenHash: hash, status, profile, migrated: false };
  }

  /**
   * A LOGIN CHANGE ON THE LIVE SESSION: sign-in, sign-out, account switch,
   * or a re-ask about a token Bloxity was unavailable for.
   *
   * Order: hold the autosaves; save the profile being LEFT from live state
   * (and stay put if that cannot land); resolve the new profile, migrating
   * live guest progress on a first login; apply it; re-run the service
   * initialisation exactly as a join does; pay pending grants; place the
   * player at spawn; save. Only the newest login counts - one that arrives
   * mid-switch is queued and applied after.
   */
  private async switchAuth(client: Client, message: SetAuthMessage, reverify: boolean): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player) return;

    const token = readToken(message?.token);
    if (session.switching) {
      session.queued = { token };
      return;
    }
    const hash = token ? tokenHash(token) : '';
    if (!reverify && hash === session.tokenHash) return;

    session.switching = true;
    try {
      const leavingKey = session.key;
      const wasGuest = session.accountKey === null;
      const live = profileStore.snapshot(player);

      if (leavingKey) {
        const landed = await withTimeout(profileStore.save(leavingKey, player), SWITCH_SAVE_TIMEOUT_MS);
        if (!landed) {
          logger.warn(SCOPE, `${client.sessionId}: storage did not take the leaving save; staying on ${leavingKey}`);
          this.sendAuthState(client, session.status, 'storage unavailable; staying on the current profile');
          return;
        }
      }

      let target: ResolvedProfile;
      try {
        target = await this.resolveProfile(session.guestKey, token, wasGuest ? live : null);
      } catch (error) {
        logger.warn(SCOPE, `${client.sessionId}: storage unreachable during a login change; staying put:`, error);
        this.sendAuthState(client, session.status, 'storage unavailable; staying on the current profile');
        return;
      }

      session.token = target.token;
      session.tokenHash = target.tokenHash;
      if (target.status === 'unavailable') {
        session.reverifyDelay = Math.min(REVERIFY_MAX_MS, session.reverifyDelay * 2);
        session.reverifyAt = Date.now() + session.reverifyDelay;
      } else {
        session.reverifyDelay = REVERIFY_FIRST_MS;
      }

      if (target.key === session.key) {
        session.status = target.status;
        this.sendAuthState(client, target.status);
        return;
      }

      // Apply, in the join's order. The live identity is kept: the portal's
      // name for the NEW login has already arrived (or is about to) by its
      // own message, and is newer than anything the stored profile holds.
      profileStore.applyTo(player, target.profile, true);
      session.key = target.key;
      session.accountKey = target.accountKey;
      session.status = target.status;
      if (target.key) this.playerIds.set(client.sessionId, target.key);
      else this.playerIds.delete(client.sessionId);

      this.forgetServices(client.sessionId);
      this.initialiseServices(client.sessionId, player);
      if (target.profile) this.speeds.syncDerived(player);
      this.placeAt(client, player, 'join');

      if (target.key) await this.saveBounded(target.key, player);
      this.sendAuthState(client, target.status);
      leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
      logger.info(
        SCOPE,
        `${client.sessionId} switched ${leavingKey || '(none)'} -> ${describe(target)}` +
          `${target.migrated ? ' [migrated]' : ''} level=${player.level} wins=${player.wins}`,
      );
    } finally {
      session.switching = false;
      const queued = session.queued;
      session.queued = null;
      if (queued) void this.switchAuth(client, queued, false);
      else if (session.accountKey) void this.applyGrants(client.sessionId);
    }
  }

  private initialiseServices(sessionId: string, player: PlayerState): void {
    if (!this.movement.has(sessionId)) this.movement.initialise(player);
    this.upgrades.initialise(player);
    this.trails.initialise(player);
    this.auras.initialise(player);
    this.charms.initialise(player);
    this.speeds.initialise(player);
    this.stages.initialise(sessionId);
  }

  /** Everything but movement, whose simulation state belongs to the connection. */
  private forgetServices(sessionId: string): void {
    this.speeds.forget(sessionId);
    this.stages.forget(sessionId);
    this.upgrades.forget(sessionId);
    this.trails.forget(sessionId);
    this.auras.forget(sessionId);
    this.charms.forget(sessionId);
  }

  private sendAuthState(client: Client, status: AuthStatus, note?: string): void {
    const message: AuthStateMessage = note ? { status, note } : { status };
    client.send(MessageType.AuthState, message);
  }

  // ---------------------------------------------------------------- input

  /**
   * One input: simulate it, then pay for the movement it actually produced.
   *
   * `applyInput` writes the authoritative transform, and only then does
   * `credit` measure the distance between the previous authoritative position
   * and this one.
   */
  private onMove(client: Client, message: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.dying.has(client.sessionId)) return;

    if (!this.movement.applyInput(client.sessionId, player, message, this.state.elapsed)) return;

    this.speeds.credit(
      client.sessionId,
      player,
      this.movement.lastStep,
      this.movement.lastDistance(player),
      this.movement.lastStepOnGround(player),
    );
    player.animation = resolveAnimation(player);
  }

  private onClaimStage(client: Client, message: ClaimStageMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const index = Number(message?.stageIndex);
    if (!Number.isFinite(index)) return;

    const award = this.stages.claim(client.sessionId, player, index);
    if (!award.granted || !award.stage) return;

    const payload: StageAwardedMessage = {
      stageIndex: award.stage.index,
      wins: award.wins,
      total: player.wins,
    };
    client.send(MessageType.StageAwarded, payload);

    // Banking a stage RETURNS the player to the spawn.
    this.placeAt(client, player, 'stage');
    this.persist(client.sessionId, player);
    leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
    logger.info(
      SCOPE,
      `stage ${award.stage.index} banked by ${client.sessionId} (+${award.wins} wins, total ${player.wins})`,
    );
  }

  private onUnlockUpgrade(client: Client, message: UnlockUpgradeMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const slot = Number(message?.slot);
    if (!Number.isFinite(slot)) return;

    const claim = this.upgrades.claim(player, slot, this.speeds);
    if (!claim.granted || !claim.tier) return;

    this.persist(client.sessionId, player);
    logger.info(SCOPE, `${client.sessionId} unlocked ${claim.tier.name} (+${claim.tier.speedPerStep}/step)`);
  }

  private onRebirth(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = this.rebirths.rebirth(player, this.speeds);
    if (!result.ok) return;

    this.placeAt(client, player, 'rebirth');
    this.persist(client.sessionId, player);
    leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
    logger.info(SCOPE, `${client.sessionId} rebirthed to ${result.rebirths} (x${result.multiplier})`);
  }

  private onUnlockTrail(client: Client, message: SlotMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const result = this.trails.unlock(player, message?.slot, this.speeds);
    if (!result.ok) return;
    this.persist(client.sessionId, player);
    logger.info(SCOPE, `${client.sessionId} unlocked ${result.tier.name}`);
  }

  private onEquipTrail(client: Client, message: SlotMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!this.trails.equip(player, message?.slot, this.speeds).ok) return;
    this.persist(client.sessionId, player);
  }

  private onUnlockAura(client: Client, message: SlotMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const result = this.auras.unlock(player, message?.slot, this.speeds);
    if (!result.ok) return;
    this.persist(client.sessionId, player);
    logger.info(SCOPE, `${client.sessionId} unlocked ${result.tier.name}`);
  }

  private onEquipAura(client: Client, message: SlotMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!this.auras.equip(player, message?.slot, this.speeds).ok) return;
    this.persist(client.sessionId, player);
  }

  private onBuyCharm(client: Client, message: BuyCharmMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const result = this.charms.buy(player, message?.shelfIndex, this.speeds);
    if (!result.ok) return;
    this.persist(client.sessionId, player);
    leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
    logger.info(SCOPE, `${client.sessionId} bought ${result.charm.name} (wins left ${result.winsAfter})`);
  }

  private onEquipCharm(client: Client, message: CharmMessage, wear: boolean): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const result = wear
      ? this.charms.equip(player, message?.slot, this.speeds)
      : this.charms.unequip(player, message?.slot, this.speeds);
    if (!result.ok) return;
    this.persist(client.sessionId, player);
  }

  private onSetAvatar(client: Client, message: SetAvatarMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.writeAvatar(player, message);
  }

  private onSetIdentity(client: Client, message: SetIdentityMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const identity = sanitizeIdentity(message);
    if (player.displayName === identity.displayName && player.avatarUrl === identity.avatarUrl) return;
    player.displayName = identity.displayName;
    player.avatarUrl = identity.avatarUrl;
    this.persist(client.sessionId, player);
    leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
  }

  private writeAvatar(player: PlayerState, message: SetAvatarMessage): void {
    player.avatar.apply(sanitizeAppearance(message?.appearance), sanitizeProportions(message?.proportions));
  }

  // ---------------------------------------------------------------- deaths

  /** Begin a death: freeze the player where they fell and start the hold. */
  private beginDeath(sessionId: string, player: PlayerState, reason: RespawnReason): void {
    if (this.dying.has(sessionId)) return;
    this.dying.set(sessionId, { remaining: DEATH_HOLD_SECONDS + DEATH_PLACE_MARGIN, reason });
    player.deathCount += 1;
    player.animation = PlayerAnimationState.Dying;
    player.sprinting = false;
    logger.info(SCOPE, `death ${sessionId} (${reason}) at ${player.z.toFixed(0)}`);
  }

  private tickDeaths(delta: number): void {
    if (this.dying.size === 0) return;
    const done: string[] = [];
    for (const [sessionId, held] of this.dying) {
      held.remaining -= delta;
      if (held.remaining <= 0) done.push(sessionId);
    }
    for (const sessionId of done) {
      const held = this.dying.get(sessionId);
      this.dying.delete(sessionId);
      const player = this.state.players.get(sessionId);
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (!held || !player || !client) continue;
      this.placeAt(client, player, held.reason);
    }
  }

  // ----------------------------------------------------------------- clock

  private tick(delta: number): void {
    this.state.elapsed += delta;
    const time = this.state.elapsed;

    leaderboardService.update(delta, this.state.leaderboard, this.state.players, this.playerIds);
    this.charms.publish(this.state.shop);
    this.tickSessions();

    for (const [sessionId, player] of this.state.players) {
      if (!player.ready) continue;
      // Time played accrues for everyone connected, dead or alive.
      player.playSeconds += delta;
      if (this.dying.has(sessionId)) continue;

      const triggers = this.movement.collision.sampleTriggers(player.x, player.y, player.z, time);
      if (triggers.fell || triggers.hazard) {
        this.beginDeath(sessionId, player, triggers.fell ? 'fell' : 'hazard');
      }
    }

    this.tickDeaths(delta);

    this.autosaveTimer += delta;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      for (const [sessionId, player] of this.state.players) this.persist(sessionId, player);
    }
  }

  /** Re-asks about tokens Bloxity was unavailable for, and polls for purchases. */
  private tickSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.switching) continue;
      if (session.status === 'unavailable' && session.token && now >= session.reverifyAt) {
        session.reverifyAt = now + session.reverifyDelay;
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) void this.switchAuth(client, { token: session.token }, true);
      }
      if (session.accountKey && now >= session.grantPollAt) {
        session.grantPollAt = now + GRANT_POLL_MS;
        void this.applyGrants(sessionId);
      }
    }
  }

  // ---------------------------------------------------------------- grants

  /**
   * Pay out what the webhook recorded for this account: CLAIM (atomic per
   * grant, so no other pod pays the same one), add the Wins, SAVE the profile,
   * and only then mark the grants applied. A pod that dies between claim and
   * settle leaves a lease that expires and is claimed again - which is why the
   * save comes before the settle and never after.
   */
  private async applyGrants(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!session || !player || !session.accountKey || session.switching || session.granting) return;
    const accountKey = session.accountKey;
    session.granting = true;
    try {
      const grants = await buxGrants.claim(accountKey);
      if (grants.length === 0) return;
      if (this.sessions.get(sessionId) !== session || session.accountKey !== accountKey || session.switching) {
        // The player moved on while the claim was in flight. The lease
        // expires and whoever holds the account next is paid.
        logger.warn(SCOPE, `left ${grants.length} claimed grant(s) for ${accountKey} to a later session`);
        return;
      }
      for (const grant of grants) {
        if (grant.wins > 0) wallet.add(player, grant.wins);
        logger.info(SCOPE, `granted ${grant.sku} to ${sessionId} (+${grant.wins} wins) [${grant.transactionId}]`);
      }
      await profileStore.save(accountKey, player);
      await buxGrants.settle(grants.map((grant) => grant.transactionId));
      leaderboardService.rebuild(this.state.leaderboard, this.state.players, this.playerIds);
    } catch (error) {
      logger.warn(SCOPE, `could not pay grants for ${accountKey}: ${String(error)}`);
    } finally {
      session.granting = false;
    }
  }

  // ------------------------------------------------------------- placement

  private respawn(client: Client, reason: RespawnReason): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.placeAt(client, player, reason);
  }

  /**
   * THE one way a player is placed, and there is exactly ONE destination:
   * `SPAWN_POSITION`. There are no checkpoints in this game.
   */
  private placeAt(client: Client, player: PlayerState, reason: RespawnReason): void {
    this.movement.teleport(
      client.sessionId,
      player,
      SPAWN_POSITION.x,
      SPAWN_POSITION.y,
      SPAWN_POSITION.z,
      SPAWN_ROTATION_Y,
    );
    this.speeds.reset(client.sessionId);
    player.animation = PlayerAnimationState.Idle;
    this.dying.delete(client.sessionId);

    const message: RespawnMessage = {
      x: SPAWN_POSITION.x,
      y: SPAWN_POSITION.y,
      z: SPAWN_POSITION.z,
      rotationY: SPAWN_ROTATION_Y,
      reason,
    };
    client.send(MessageType.Respawn, message);

    if (reason !== 'join') logger.info(SCOPE, `place ${client.sessionId} -> spawn (${reason})`);
  }

  // ----------------------------------------------------------------- saves

  /** A routine save. Held while the session is changing login. */
  private persist(sessionId: string, player: PlayerState): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.key || session.switching) return;
    void this.saveQuietly(session.key, player);
  }

  private async saveQuietly(key: string, player: PlayerState): Promise<void> {
    try {
      await profileStore.save(key, player);
    } catch (error) {
      logger.error(SCOPE, `save of ${key} failed:`, error);
    }
  }

  /**
   * A save that is waited for only so long. It stays queued and retried
   * whatever happens here; this only decides how long the caller (a leaving
   * socket, a disposing room) is held up by an outage.
   */
  private async saveBounded(key: string, player: PlayerState): Promise<void> {
    const landed = await withTimeout(this.saveQuietly(key, player), LEAVE_SAVE_TIMEOUT_MS);
    if (!landed) logger.warn(SCOPE, `save of ${key} is queued; it lands when storage is back`);
  }
}

/** A guest key from a join option: valid, or empty when none was sent. Refuses the account prefix. */
const readGuestKey = (raw: unknown): string => {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'string' && isAccountKey(raw)) {
    logger.warn(SCOPE, `refused a join: browser id carries the account prefix`);
    throw new ServerError(JOIN_ERROR.BAD_PLAYER_ID, 'invalid player id');
  }
  if (!isValidGuestId(raw)) {
    logger.warn(SCOPE, `refused a join: malformed browser id`);
    throw new ServerError(JOIN_ERROR.BAD_PLAYER_ID, 'invalid player id');
  }
  return raw;
};

const readToken = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_TOKEN_LENGTH ? raw : null;

const describe = (resolved: ResolvedProfile): string => {
  if (resolved.accountKey) return `account ${resolved.accountKey}`;
  const key = resolved.guestKey || '(no id)';
  return resolved.status === 'unavailable' ? `guest ${key} (bloxity unavailable, will re-ask)` : `guest ${key}`;
};

/** True if the promise settled within the deadline; it keeps running either way. */
const withTimeout = (promise: Promise<unknown>, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });

/**
 * The animation state a replicated player is in, derived from motion the
 * server already owns.
 */
const resolveAnimation = (player: PlayerState): PlayerAnimationState => {
  if (!player.grounded) {
    return player.verticalVelocity > 0 ? PlayerAnimationState.Jumping : PlayerAnimationState.Falling;
  }
  if (player.treadmill > 0) return player.sprinting ? PlayerAnimationState.Sprint : PlayerAnimationState.Run;
  if (player.speed < 0.6) return PlayerAnimationState.Idle;
  // A sprint reads as a sprint only once the boost has actually taken hold.
  const runTop = 16 * player.moveMultiplier;
  return player.sprinting && player.speed > runTop * (1 + (SPRINT.boost - 1) * 0.4)
    ? PlayerAnimationState.Sprint
    : PlayerAnimationState.Run;
};
