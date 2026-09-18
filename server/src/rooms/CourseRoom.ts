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
  createMotion,
  sanitizeAppearance,
  sanitizeIdentity,
  sanitizeProportions,
  type BuyCharmMessage,
  type CharmMessage,
  type ClaimStageMessage,
  type MoveMessage,
  type PlayerMotion,
  type RespawnMessage,
  type RespawnReason,
  type SetAvatarMessage,
  type SetIdentityMessage,
  type SlotMessage,
  type StageAwardedMessage,
  type UnlockUpgradeMessage,
} from '@godspeed/shared';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
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

interface JoinOptions {
  playerId?: string;
  name?: string;
  bloxityId?: string;
  avatar?: SetAvatarMessage;
  identity?: SetIdentityMessage;
}

/**
 * The authoritative room.
 *
 * Composition only: every rule lives in a service, and this decides the order
 * they run in. What it owns outright is the CLOCK. The one hard rule: nothing
 * a client sends is ever copied into state. A Move is simulated, a claim is
 * validated, and both produce a result the server writes itself.
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

  private readonly playerIds = new Map<string, string>();
  private readonly bloxityIds = new Map<string, string>();
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

    this.charms.publish(this.state.shop);

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), serverConfig.patchRateMs);

    logger.info(SCOPE, `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`);
  }

  /** The capacity check that does not depend on the matchmaker. */
  override onAuth(): boolean {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) {
      logger.warn(
        SCOPE,
        `refused a join: room ${this.roomId} is full (${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`,
      );
      throw new ServerError(4103, 'room is full');
    }
    return true;
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new PlayerState();
    player.sessionId = client.sessionId;

    const bloxityId = typeof options.bloxityId === 'string' ? options.bloxityId.slice(0, 64) : '';
    const browserId = typeof options.playerId === 'string' ? options.playerId.slice(0, 64) : '';
    /*
     * PROGRESSION FOLLOWS THE ACCOUNT. A signed-in player's profile is keyed
     * by their Bloxity id, so it follows them between browsers; a guest's is
     * keyed by the id their browser generated.
     */
    const playerId = bloxityId ? `bx_${bloxityId}` : browserId;
    if (playerId) this.playerIds.set(client.sessionId, playerId);

    // Restore BEFORE any service initialises: everything derived is derived
    // from the restored figures.
    const restored = playerId ? profileStore.restore(playerId, player) : false;

    this.state.players.set(client.sessionId, player);

    this.movement.initialise(player);
    this.upgrades.initialise(player);
    this.trails.initialise(player);
    this.auras.initialise(player);
    this.charms.initialise(player);
    this.speeds.initialise(player);
    this.stages.initialise(client.sessionId);

    if (bloxityId) {
      this.bloxityIds.set(client.sessionId, bloxityId);
      this.applyGrants(client.sessionId, player);
    }
    if (options.avatar) this.writeAvatar(player, options.avatar);
    if (options.identity) {
      const identity = sanitizeIdentity(options.identity);
      if (identity.displayName) {
        player.displayName = identity.displayName;
        player.avatarUrl = identity.avatarUrl;
      }
    }

    if (restored) this.speeds.syncDerived(player);

    this.placeAt(client, player, 'join');

    logger.info(
      SCOPE,
      `join ${client.sessionId} (${restored ? 'restored' : 'new'}) ` +
        `level=${player.level} wins=${player.wins} upgrade=${player.upgradeSlot}`,
    );
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const playerId = this.playerIds.get(client.sessionId);
    if (player && playerId) profileStore.save(playerId, player);

    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.speeds.forget(client.sessionId);
    this.stages.forget(client.sessionId);
    this.upgrades.forget(client.sessionId);
    this.trails.forget(client.sessionId);
    this.auras.forget(client.sessionId);
    this.charms.forget(client.sessionId);
    this.bloxityIds.delete(client.sessionId);
    this.playerIds.delete(client.sessionId);
    this.dying.delete(client.sessionId);

    logger.info(SCOPE, `leave ${client.sessionId}`);
  }

  override onDispose(): void {
    for (const [sessionId, player] of this.state.players) {
      const playerId = this.playerIds.get(sessionId);
      if (playerId) profileStore.save(playerId, player);
    }
    logger.info(SCOPE, `room ${this.roomId} disposed`);
  }

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

  private tick(delta: number): void {
    this.state.elapsed += delta;
    const time = this.state.elapsed;

    leaderboardService.update(delta, this.state.leaderboard, this.state.players, this.playerIds);
    this.charms.publish(this.state.shop);

    if (buxGrants.hasPending) {
      for (const [sessionId, player] of this.state.players) this.applyGrants(sessionId, player);
    }

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

  private applyGrants(sessionId: string, player: PlayerState): void {
    const bloxityId = this.bloxityIds.get(sessionId);
    if (!bloxityId) return;
    const grants = buxGrants.drain(bloxityId);
    if (grants.length === 0) return;
    for (const grant of grants) {
      if (grant.wins > 0) wallet.add(player, grant.wins);
      logger.info(SCOPE, `granted ${grant.sku} to ${sessionId} (+${grant.wins} wins) [${grant.transactionId}]`);
    }
    this.persist(sessionId, player);
  }

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

  private persist(sessionId: string, player: PlayerState): void {
    const playerId = this.playerIds.get(sessionId);
    if (playerId) profileStore.save(playerId, player);
  }
}

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
