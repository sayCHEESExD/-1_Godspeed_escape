/**
 * THE SPRINT: the god power.
 *
 * Holding Q (or the SPRINT button on touch) unleashes it. It is a temporary
 * boost with a bar: the bar drains while the key is held and refills on its
 * own when it is released, quickly, so the rhythm is sprint - breathe - sprint
 * rather than sprint once a minute.
 *
 * Part of the SHARED simulation, not a client effect: the boost changes where
 * the player goes, so the server owns the energy and applies the boost, and
 * the client predicts with the identical numbers. Nothing here is sent by a
 * client except the fact that the key is held.
 */
export interface SprintConfig {
  /** Multiplier on run speed while sprinting. */
  readonly boost: number;
  /** The bar's capacity. Displayed as a fraction, so the unit is arbitrary. */
  readonly maxEnergy: number;
  /** Energy spent per second held. A full bar is ~3.6 seconds of sprint. */
  readonly drainPerSecond: number;
  /** Energy regained per second released. A full refill takes ~2.5 seconds. */
  readonly regenPerSecond: number;
  /** Seconds after release before regeneration begins. */
  readonly regenDelay: number;
  /**
   * Energy needed to START a sprint once the bar has run dry.
   *
   * Without a threshold a drained bar would flicker on and off at the bottom
   * as the key is held: one frame of regen buys one frame of sprint. The bar
   * has to visibly recover a little before the power answers again.
   */
  readonly minToRestart: number;
  /** Acceleration multiplier while sprinting, so the boost ARRIVES. */
  readonly accelerationBoost: number;
}

export const SPRINT: SprintConfig = {
  boost: 1.85,
  maxEnergy: 100,
  drainPerSecond: 28,
  regenPerSecond: 40,
  regenDelay: 0.25,
  minToRestart: 20,
  accelerationBoost: 1.6,
};

/**
 * The effective drain, given the player's charm bonuses.
 *
 * "+7% sprint duration" is spelled as a capacity multiplier: the bar lasts 7%
 * longer, so the drain is divided by 1.07. Kept as a function so the charm
 * service and the simulation agree on exactly how a percentage becomes
 * seconds.
 */
export const sprintDrainPerSecond = (capacityMultiplier: number): number => {
  const capacity =
    Number.isFinite(capacityMultiplier) && capacityMultiplier > 0 ? capacityMultiplier : 1;
  return SPRINT.drainPerSecond / capacity;
};
