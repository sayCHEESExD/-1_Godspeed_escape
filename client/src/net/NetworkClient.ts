import {
  MessageType,
  ROOM_NAME,
  decodeShelf,
  type BuyCharmMessage,
  type CharmMessage,
  type ClaimStageMessage,
  type MoveMessage,
  type RespawnMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
  type SlotMessage,
  type StageAwardedMessage,
  type UnlockUpgradeMessage,
} from '@godspeed/shared';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { clientConfig } from '../config/clientConfig.js';
import { logger } from '../util/logger.js';
import type {
  ConnectionStatus,
  LeaderboardSnapshot,
  NetCourseState,
  NetLeaderEntry,
  NetPlayerState,
  ShopSnapshot,
} from './netTypes.js';

const SCOPE = 'NetworkClient';

/** Key under which this browser's stable player id is kept. */
const PLAYER_ID_KEY = 'godspeed.playerId';

/** Backoff between join attempts, in milliseconds. A cold host takes a while. */
const JOIN_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolvePlayerId = (): string => {
  const fresh = `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    const existing = window.localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(PLAYER_ID_KEY, fresh);
  } catch {
    return fresh;
  }
  return fresh;
};

export interface NetworkHandlers {
  onStatusChange?(status: ConnectionStatus, detail?: string): void;
  onSelfJoined?(sessionId: string): void;
  onPlayerAdded?(sessionId: string, player: NetPlayerState): void;
  onPlayerChanged?(sessionId: string, player: NetPlayerState): void;
  onPlayerRemoved?(sessionId: string): void;
  onRespawn?(message: RespawnMessage): void;
  onStageAwarded?(message: StageAwardedMessage): void;
}

/**
 * Thin wrapper over colyseus.js. The rest of the client never imports
 * colyseus.js directly.
 */
export class NetworkClient {
  private readonly handlers: NetworkHandlers;
  private client: Client | null = null;
  private room: Room<NetCourseState> | null = null;
  private status: ConnectionStatus = 'idle';
  private identity: (() => string | null) | null = null;
  private look: (() => SetAvatarMessage | null) | null = null;
  private identityOf: (() => SetIdentityMessage) | null = null;

  constructor(handlers: NetworkHandlers = {}) {
    this.handlers = handlers;
  }

  setLookProvider(provider: () => SetAvatarMessage | null): void {
    this.look = provider;
  }

  sendAvatar(message: SetAvatarMessage): void {
    this.room?.send(MessageType.SetAvatar, message);
  }

  sendIdentity(message: SetIdentityMessage): void {
    this.room?.send(MessageType.SetIdentity, message);
  }

  setIdentityProvider(provider: () => string | null): void {
    this.identity = provider;
  }

  setDisplayProvider(provider: () => SetIdentityMessage): void {
    this.identityOf = provider;
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** The server's clock, in seconds. The hazards are a pure function of it. */
  get elapsed(): number {
    return this.room?.state?.elapsed ?? 0;
  }

  async connect(): Promise<void> {
    if (!clientConfig.serverUrl) {
      this.setStatus('error');
      throw new Error(
        'No game server is configured. Set VITE_SERVER_URL to the Colyseus ' +
          'endpoint (for example wss://your-server-host) and rebuild.',
      );
    }

    this.setStatus('connecting');
    logger.info(SCOPE, `joining "${ROOM_NAME}" at ${clientConfig.serverUrl}`);

    this.client ??= new Client(clientConfig.serverUrl);
    const playerId = resolvePlayerId();
    const attempts = JOIN_BACKOFF_MS.length + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        this.room = await this.client.joinOrCreate<NetCourseState>(ROOM_NAME, {
          playerId,
          bloxityId: this.identity?.() ?? undefined,
          avatar: this.look?.() ?? undefined,
          identity: this.identityOf?.() ?? undefined,
        });
        break;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(SCOPE, `join attempt ${attempt}/${attempts} failed: ${detail}`);
        if (attempt === attempts) {
          this.setStatus('error', detail);
          throw error;
        }
        this.setStatus('connecting', `attempt ${attempt + 1}/${attempts}`);
        await sleep(JOIN_BACKOFF_MS[attempt - 1] ?? 0);
      }
    }

    if (!this.room) throw new Error('join produced no room');

    this.bindRoom(this.room);
    this.setStatus('connected');
    logger.info(SCOPE, `joined roomId=${this.room.roomId} sessionId=${this.room.sessionId}`);
    this.handlers.onSelfJoined?.(this.room.sessionId);
  }

  /** Report one simulated input. Deliberately NOT rate limited. */
  sendInput(message: MoveMessage): void {
    this.room?.send(MessageType.Move, message);
  }

  claimStage(stageIndex: number): void {
    const message: ClaimStageMessage = { stageIndex };
    this.room?.send(MessageType.ClaimStage, message);
  }

  unlockUpgrade(slot: number): void {
    const message: UnlockUpgradeMessage = { slot };
    this.room?.send(MessageType.UnlockUpgrade, message);
  }

  requestRebirth(): void {
    this.room?.send(MessageType.Rebirth, {});
  }

  unlockTrail(slot: number): void {
    const message: SlotMessage = { slot };
    this.room?.send(MessageType.UnlockTrail, message);
  }

  equipTrail(slot: number): void {
    const message: SlotMessage = { slot };
    this.room?.send(MessageType.EquipTrail, message);
  }

  unlockAura(slot: number): void {
    const message: SlotMessage = { slot };
    this.room?.send(MessageType.UnlockAura, message);
  }

  equipAura(slot: number): void {
    const message: SlotMessage = { slot };
    this.room?.send(MessageType.EquipAura, message);
  }

  buyCharm(shelfIndex: number): void {
    const message: BuyCharmMessage = { shelfIndex };
    this.room?.send(MessageType.BuyCharm, message);
  }

  equipCharm(slot: number, wear: boolean): void {
    const message: CharmMessage = { slot };
    this.room?.send(wear ? MessageType.EquipCharm : MessageType.UnequipCharm, message);
  }

  requestRespawn(): void {
    this.room?.send(MessageType.RequestRespawn, {});
  }

  /** The three leaderboards, COPIED out of the schema as plain arrays. */
  get leaderboard(): LeaderboardSnapshot | null {
    const board = this.room?.state?.leaderboard;
    if (!board) return null;
    const copy = (rows: ArrayLike<NetLeaderEntry>): NetLeaderEntry[] => {
      const out: NetLeaderEntry[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row) out.push({ handle: row.handle, name: row.name, avatarUrl: row.avatarUrl, value: row.value });
      }
      return out;
    };
    return { wins: copy(board.wins), rebirths: copy(board.rebirths), time: copy(board.time) };
  }

  /** The charm shop's shelf and countdown, as plain data. */
  get shop(): ShopSnapshot | null {
    const shop = this.room?.state?.shop;
    if (!shop) return null;
    return { shelf: decodeShelf(shop.shelf ?? ''), restockIn: shop.restockIn ?? 0 };
  }

  async disconnect(): Promise<void> {
    await this.room?.leave(true);
    this.room = null;
    this.setStatus('disconnected');
  }

  private bindRoom(room: Room<NetCourseState>): void {
    const $ = getStateCallbacks(room);

    $(room.state).players.onAdd((player, sessionId) => {
      this.handlers.onPlayerAdded?.(sessionId, player);
      $(player).onChange(() => {
        this.handlers.onPlayerChanged?.(sessionId, player);
      });
      // A NESTED schema's changes do not bubble to its parent.
      $(player.avatar).onChange(() => {
        this.handlers.onPlayerChanged?.(sessionId, player);
      });
    });

    $(room.state).players.onRemove((_player, sessionId) => {
      this.handlers.onPlayerRemoved?.(sessionId);
    });

    room.onMessage<RespawnMessage>(MessageType.Respawn, (message) => {
      this.handlers.onRespawn?.(message);
    });

    room.onMessage<StageAwardedMessage>(MessageType.StageAwarded, (message) => {
      this.handlers.onStageAwarded?.(message);
    });

    room.onError((code, message) => {
      logger.error(SCOPE, `room error ${code}: ${message ?? ''}`);
      this.setStatus('error', message);
    });

    room.onLeave((code) => {
      logger.warn(SCOPE, `left room (code ${code})`);
      this.setStatus('disconnected', `code ${code}`);
    });
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.handlers.onStatusChange?.(status, detail);
  }
}
