import type { AvatarAppearance, AvatarProportions } from '@godspeed/shared';
import type { PlayerAnimationState, PlayerMotionState } from '@godspeed/shared';
import type { MapSchema } from '@colyseus/schema';

/**
 * Client-side TYPE mirror of the server's Colyseus schema.
 *
 * Types only - colyseus.js builds the concrete schema instances at runtime
 * from the handshake reflection.
 */
export interface NetPlayerState extends PlayerMotionState {
  sessionId: string;
  displayName: string;
  avatarUrl: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  animation: PlayerAnimationState;

  level: number;
  rebirths: number;
  wins: number;
  totalSpeed: number;
  upgradeSlot: number;
  ownedUpgrades: number;
  speedPerStep: number;
  moveMultiplier: number;
  jumpVelocity: number;
  bestStage: number;
  ownedTrails: number;
  trailSlot: number;
  ownedAuras: number;
  auraSlot: number;
  ownedCharms: number;
  equippedCharms: number;
  sprintCapacity: number;
  playSeconds: number;

  velocityX: number;
  velocityY: number;
  velocityZ: number;
  lastInputSeq: number;
  jumpLatched: boolean;
  coyote: number;
  sprintLocked: boolean;
  sprintRest: number;
  ready: boolean;

  avatar: AvatarAppearance & AvatarProportions;
}

export interface NetLeaderEntry {
  handle: string;
  name: string;
  avatarUrl: string;
  value: number;
}

export interface NetLeaderboardState {
  wins: ArrayLike<NetLeaderEntry>;
  rebirths: ArrayLike<NetLeaderEntry>;
  time: ArrayLike<NetLeaderEntry>;
}

export interface NetShopState {
  shelf: string;
  restockIn: number;
}

export interface NetCourseState {
  players: MapSchema<NetPlayerState>;
  elapsed: number;
  leaderboard: NetLeaderboardState;
  shop: NetShopState;
}

/** A leaderboard flattened into plain data, ready to draw. */
export interface LeaderboardSnapshot {
  wins: readonly NetLeaderEntry[];
  rebirths: readonly NetLeaderEntry[];
  time: readonly NetLeaderEntry[];
}

/** The charm shop's shelf, as plain data. */
export interface ShopSnapshot {
  /** Catalogue slots on the shelf, in shelf order. */
  shelf: readonly number[];
  /** Whole seconds until the next restock. */
  restockIn: number;
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
