import type { AvatarAppearance, AvatarProportions } from './avatar.js';

/**
 * Client -> server input (MessageType.Move).
 *
 * INPUT ONLY. There is deliberately no position, velocity or rotation here:
 * the server simulates movement from intent and owns the result, so a client
 * has no channel through which to assert where it is.
 */
export interface MoveMessage {
  /** Monotonically increasing input sequence number. */
  seq: number;
  /** Seconds this input covers. Clamped and rate-limited server-side. */
  dt: number;
  /** -1..1, camera-relative. */
  moveX: number;
  /** -1..1, camera-relative. */
  moveZ: number;
  /** The jump key, held. Only a fresh PRESS produces a leap. */
  jump: boolean;
  /** The SPRINT key (Q), held. The god power runs while it is down. */
  sprint: boolean;
  /** Yaw the camera faced, so movement is camera-relative. */
  cameraYaw: number;
}

/** Why a run ended. */
export type RespawnReason =
  /** Fell out of the world, or into the cloud sea below it. */
  | 'fell'
  /** Hit a lightning bolt, a spear bed or another hazard. */
  | 'hazard'
  /** Asked to be put back. */
  | 'manual'
  /** Just joined. */
  | 'join'
  /** Banked a stage and was returned to the spawn. */
  | 'stage'
  /** Rebirthed, which resets the run as well as the level curve. */
  | 'rebirth';

/** Server -> client authoritative respawn (MessageType.Respawn). */
export interface RespawnMessage {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  reason: RespawnReason;
}

/** Client -> server: "I reached this stage's win pad." A request, never a grant. */
export interface ClaimStageMessage {
  stageIndex: number;
}

/** Server -> client: a stage reward landed. Presentation only. */
export interface StageAwardedMessage {
  stageIndex: number;
  wins: number;
  /** Wins the player now holds, so the HUD can pop without waiting a patch. */
  total: number;
}

/** Client -> server: "rebirth me". Deliberately empty. */
export type RebirthMessage = Record<string, never>;

/** Client -> server: "I am on this upgrade tile, unlock it." */
export interface UnlockUpgradeMessage {
  slot: number;
}

/** Client -> server: unlock or wear a trail / aura by slot. */
export interface SlotMessage {
  slot: number;
}

/** Client -> server: buy the charm on this SHOP SHELF position (0-based). */
export interface BuyCharmMessage {
  shelfIndex: number;
}

/** Client -> server: wear or remove an owned charm by catalogue slot. */
export interface CharmMessage {
  slot: number;
}

/** Client -> server: the player's Bloxity appearance. */
export interface SetAvatarMessage {
  appearance: AvatarAppearance;
  proportions: AvatarProportions;
}

/** Client -> server: who the player IS, as the portal knows them. */
export interface SetIdentityMessage {
  displayName: string;
  avatarUrl: string;
}

/**
 * Client -> server: the portal's game TOKEN, or null when signed out
 * (MessageType.SetAuth). Sent at join (as a join option) and again whenever
 * the login changes. The server verifies it with Bloxity; nothing in it is
 * trusted until Bloxity has answered.
 */
export interface SetAuthMessage {
  token: string | null;
}

/** Whose progress a session is playing on. */
export type AuthStatus =
  /** A verified Bloxity account. Progress follows the account. */
  | 'account'
  /** No token, or a token Bloxity rejected. Progress follows the browser. */
  | 'guest'
  /**
   * A token Bloxity could not be asked about (timeout, outage). Playing as a
   * guest for now; the server re-asks on a backoff and switches when it can.
   */
  | 'unavailable';

/** Server -> client (MessageType.AuthState): the outcome of a SetAuth. */
export interface AuthStateMessage {
  status: AuthStatus;
  /** Why a requested switch did not happen, when it did not. */
  note?: string;
}
