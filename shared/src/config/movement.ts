import { SPRINT } from './sprint.js';

/**
 * Movement tuning for a RUNNING CHARACTER.
 *
 * The client predicts with these numbers and the server simulates with them,
 * so they must not diverge - which is why there is one copy, here.
 *
 * TWO ground gaits: the RUN, and the SPRINT on top of it. Sprint is the god
 * power the whole game is built around, so it is part of the shared step
 * rather than a client-side flourish - the server drains the energy, the
 * server applies the boost, and the client predicts exactly the same.
 *
 * There is exactly ONE airborne mechanic and it is a JUMP: a single impulse on
 * a fresh press from the ground. Every gap in the course is authored against
 * the arc one press produces at a run AND at a sprint.
 */
export interface MovementConfig {
  /** THE run speed, in world units per second, before every multiplier. */
  readonly moveSpeed: number;
  /** Ground acceleration, world units per second squared. */
  readonly acceleration: number;
  /** Ground deceleration when the stick is released. */
  readonly deceleration: number;
  /** Fraction of ground acceleration retained while airborne (0..1). */
  readonly airControl: number;
  /** Downward acceleration, world units per second squared. */
  readonly gravity: number;
  /** Upward velocity applied by a jump, world units per second. */
  readonly jumpVelocity: number;
  /** Turn rate toward the movement direction, radians per second. */
  readonly turnSpeed: number;
  /**
   * Largest distance the simulation will integrate in one substep.
   *
   * `stepPlayer` subdivides its own step until every substep moves less than
   * this, so collision is exactly as reliable at a sprint as at a walk.
   */
  readonly maxSubstepDistance: number;
  /** Most substeps one step may take, so a pathological speed cannot hang. */
  readonly maxSubsteps: number;
  /**
   * Height the character steps up without jumping.
   *
   * A platform lip, a stair riser and an upgrade tile are all below this. It
   * must stay equal to `LANDING_TOLERANCE` in `WorldCollision`.
   */
  readonly stepHeight: number;
}

/**
 * Tuned for a 3.2-unit character on a course of 10-unit platforms.
 *
 * Airtime is `2v/g` = 0.84 seconds, so a run covers 13.4 units per leap and a
 * sprint 24, and a leap rises 5.4 units. `ballisticFor` in the course config
 * turns these into the gaps and climbs every stage is authored against.
 */
export const MOVEMENT: MovementConfig = {
  moveSpeed: 16,
  acceleration: 96,
  deceleration: 80,
  airControl: 0.55,
  gravity: 62,
  jumpVelocity: 26,
  turnSpeed: 11,
  maxSubstepDistance: 0.6,
  maxSubsteps: 48,
  stepHeight: 1.0,
};

/**
 * How level and rebirth combine into ONE movement profile.
 *
 * This is the single evaluator: nothing else may compute a movement speed.
 * The server resolves it and replicates the multiplier; the client multiplies
 * the base speeds above by exactly that and never derives its own.
 *
 * DELIBERATELY GENTLE. "Speed" in this game is the progression FIGURE - the
 * number on the HUD, what levels are made of - and it is NOT how fast the
 * character moves. Movement grows a little with level so a veteran feels
 * quicker, and it is soft-capped so the course stays readable at level 200.
 * The real change of pace is the SPRINT, and that is a god power with a bar.
 */
export interface MovementProfile {
  /** Multiplier on `moveSpeed`. */
  readonly multiplier: number;
  /** Resolved run speed in world units per second. */
  readonly moveSpeed: number;
  /** Resolved jump velocity. */
  readonly jumpVelocity: number;
}

/** Movement speed added per level, as a fraction of the base. */
const SPEED_PER_LEVEL = 0.012;

/** Levels over which the per-level gain decays to half its value. */
const LEVEL_SOFT_CAP = 60;

/**
 * Resolve the profile a player actually moves at.
 *
 * @param level     current level, 1-based
 * @param rebirths  completed rebirth count
 */
export const resolveMovementProfile = (level: number, rebirths: number): MovementProfile => {
  const steps = Math.max(0, Math.floor(level) - 1);
  // Diminishing returns: converges on x1.72 at the level cap and never beyond.
  const levelGain = (steps / (1 + steps / LEVEL_SOFT_CAP)) * SPEED_PER_LEVEL;
  // Each rebirth is a small, permanent nudge - a veteran of ten rebirths runs
  // about a fifth faster than a fresh player. The SPEED FIGURE is where a
  // rebirth's real multiplier lands; see `rebirthMultiplier`.
  const rebirthGain = Math.min(Math.max(0, Math.floor(rebirths)), 20) * 0.01;
  const multiplier = 1 + levelGain + rebirthGain;

  return {
    multiplier,
    moveSpeed: MOVEMENT.moveSpeed * multiplier,
    // The jump grows FAR more gently than travel speed: elevation is the gate
    // on this course and width is the texture, and a jump that grew with the
    // multiplier would let a veteran clear every climb in the game.
    jumpVelocity: MOVEMENT.jumpVelocity * (1 + (multiplier - 1) * 0.12),
  };
};

/** The top speed a sprinting player reaches, for the camera and the HUD. */
export const sprintSpeedFor = (profile: MovementProfile): number =>
  profile.moveSpeed * SPRINT.boost;

/**
 * Movement speed shown as kilometres per hour on the HUD.
 *
 * Presentation only: one world unit is treated as one metre, so a walk at 16
 * u/s is "58 km/h" - which reads as a god running, which is the point.
 */
export const toKmh = (unitsPerSecond: number): number =>
  Math.round(Math.max(0, unitsPerSecond) * 3.6);
