/**
 * Transform-only view of a player, used for both the local prediction and the
 * replicated remote players.
 */
export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. Pitch and roll are presentation, so they are not sent. */
  rotationY: number;
}

/**
 * Visual states the animator can be in.
 *
 * PRESENTATION only. Gameplay authority - position, progression, whether a
 * jump is allowed - never lives here.
 */
export const PlayerAnimationState = {
  Idle: 'idle',
  /** The walk/run cycle. */
  Run: 'run',
  /** The same cycle at full power: longer stride, harder lean, arms pumping. */
  Sprint: 'sprint',
  Jumping: 'jumping',
  Falling: 'falling',
  Landing: 'landing',
  Dying: 'dying',
} as const;

export type PlayerAnimationState =
  (typeof PlayerAnimationState)[keyof typeof PlayerAnimationState];

/**
 * The compact per-player signals a client needs to reconstruct another
 * player's animation locally. Bone transforms are NEVER sent.
 */
export interface PlayerMotionState {
  /** Horizontal speed in world units per second. */
  speed: number;
  /** Vertical velocity in world units per second. Rise versus fall. */
  verticalVelocity: number;
  grounded: boolean;
  /** Monotonic count of jumps, so a remote can trigger the leap. */
  jumpCount: number;
  /** Monotonic count of deaths, so a remote can play the fall-over. */
  deathCount: number;
  /** Treadmill the player is standing on, or 0. */
  treadmill: number;
  /** True while the god power is running. Drives the sprint effect. */
  sprinting: boolean;
  /** Sprint energy, 0..SPRINT.maxEnergy. */
  sprintEnergy: number;
}

/** Server-authoritative progression snapshot. */
export interface PlayerProgression {
  level: number;
  rebirths: number;
  wins: number;
  /** Lifetime Speed earned. Drives level. */
  totalSpeed: number;
  /** Equipped speed upgrade slot - the best one owned. */
  upgradeSlot: number;
  ownedUpgrades: number;
  moveMultiplier: number;
  jumpVelocity: number;
  maxLevel: number;
  /** Speed granted per step, resolved by the one shared formula. */
  speedPerStep: number;
  bestStage: number;
  ownedTrails: number;
  trailSlot: number;
  ownedAuras: number;
  auraSlot: number;
  ownedCharms: number;
  equippedCharms: number;
  /** Multiplier on sprint capacity from charms. The client predicts with it. */
  sprintCapacity: number;
  /** Seconds played, lifetime. The Top Time board. */
  playSeconds: number;
}

/** Everything the client knows about a replicated player. */
export interface PlayerSnapshot
  extends PlayerTransform,
    PlayerMotionState,
    PlayerProgression {
  sessionId: string;
  animation: PlayerAnimationState;
}
