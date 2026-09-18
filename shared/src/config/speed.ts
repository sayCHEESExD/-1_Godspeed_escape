import { auraMultiplier } from './auras.js';
import { charmBonuses } from './charms.js';
import { rebirthMultiplier } from './rebirth.js';
import { trailBonus } from './trails.js';
import { upgradeForSlot } from './upgrades.js';

/**
 * SPEED: the progression figure, and the level curve it feeds.
 *
 * Speed is EARNED BY STEPS. A step is `SPEED.strideDistance` units of actual
 * travel on the ground - about six a second at a run, ten at a sprint - and
 * every step pays the player's rate. A treadmill supplies the distance
 * instead, at the base run speed, so a player standing on one takes steps
 * without going anywhere.
 *
 * THE RATE is the product of exactly these things, and nothing else:
 *
 *   (equipped upgrade's Speed/step + worn trail's flat bonus)
 *     x rebirth multiplier x worn aura's multiplier x charm speed bonus
 *
 * `speedPerStepFor` is the ONE place that product is computed; the server
 * calls it to pay and to replicate the advertised figure, and the client only
 * ever displays what was replicated.
 */
export interface SpeedConfig {
  /** World units of ground travel that make one STEP. */
  readonly strideDistance: number;
  /** Ground speed below which the player counts as NOT MOVING. */
  readonly movingSpeed: number;
  /**
   * Largest distance the server will credit from one simulated step, as a
   * multiple of the step's own maximum honest travel. A teleport pays nothing.
   */
  readonly creditSlack: number;
}

export const SPEED: SpeedConfig = {
  strideDistance: 2.4,
  movingSpeed: 1.5,
  creditSlack: 1.6,
};

/** Everything that decides a player's Speed per step. */
export interface SpeedRateInputs {
  readonly upgradeSlot: number;
  readonly trailSlot: number;
  readonly ownedTrails: number;
  readonly auraSlot: number;
  readonly ownedAuras: number;
  readonly equippedCharms: number;
  readonly ownedCharms: number;
  readonly rebirths: number;
}

/** THE rate, in Speed per step. The one formula. */
export const speedPerStepFor = (inputs: SpeedRateInputs): number => {
  const base =
    upgradeForSlot(inputs.upgradeSlot).speedPerStep +
    trailBonus(inputs.trailSlot, inputs.ownedTrails);
  const charms = charmBonuses(inputs.equippedCharms, inputs.ownedCharms);
  return (
    base *
    rebirthMultiplier(inputs.rebirths) *
    auraMultiplier(inputs.auraSlot, inputs.ownedAuras) *
    charms.speed
  );
};

/**
 * A human-readable breakdown of the rate, for the server log and the HUD tip.
 */
export const describeSpeedRate = (inputs: SpeedRateInputs): string => {
  const upgrade = upgradeForSlot(inputs.upgradeSlot);
  const trail = trailBonus(inputs.trailSlot, inputs.ownedTrails);
  const aura = auraMultiplier(inputs.auraSlot, inputs.ownedAuras);
  const charms = charmBonuses(inputs.equippedCharms, inputs.ownedCharms);
  return (
    `(${upgrade.speedPerStep} + trail ${trail}) x rebirth ${rebirthMultiplier(inputs.rebirths)}` +
    ` x aura ${aura} x charms ${charms.speed.toFixed(2)} = ${speedPerStepFor(inputs)}`
  );
};

// ---------------------------------------------------------------- the curve

/**
 * The level curve.
 *
 * Geometric from the reference figures: level 10 needs 245, 11 needs 264, 12
 * needs 284 and 21 needs 544, which is a base of 128 growing 7.5% a level.
 * Past `taperFrom` the growth eases to 4.5% so the top of the ladder is a long
 * climb rather than an absurd one - level 200 asks for about 2.5 million
 * Speed, which a late-game rate of tens of thousands a step covers in
 * minutes rather than days.
 */
export const LEVEL_CURVE = {
  base: 128,
  growth: 1.075,
  taperFrom: 40,
  taperGrowth: 1.045,
} as const;

/**
 * Speed needed to advance FROM `level` to the next one.
 *
 * Rounded, and the rounding is load-bearing: the HUD prints this figure and
 * the cumulative table sums the same rounded values, so the bar's "226 / 544"
 * and the level it is attached to can never be a fraction apart.
 */
export const speedForNextLevel = (level: number): number => {
  const step = Math.max(1, Math.floor(level));
  const fast = Math.min(step - 1, LEVEL_CURVE.taperFrom - 1);
  const slow = Math.max(0, step - LEVEL_CURVE.taperFrom);
  return Math.round(
    LEVEL_CURVE.base * LEVEL_CURVE.growth ** fast * LEVEL_CURVE.taperGrowth ** slow,
  );
};

/**
 * Cumulative Speed needed to have REACHED each level, GROWN ON DEMAND.
 *
 * `CUMULATIVE[L]` is the total to reach level L; level 1 costs nothing. There
 * is NO LEVEL CAP, so the table is extended as far as any lookup needs and no
 * further: a level lookup is a binary search over what has been built. The
 * curve is exponential, so a cost that stops being a finite number is where
 * the table stops - thousands of levels past anything a player can reach.
 */
const CUMULATIVE: number[] = [0, 0];

/** Make sure the table reaches `level`, or the end of finite numbers. */
const extendTo = (level: number): void => {
  while (CUMULATIVE.length <= level) {
    const last = CUMULATIVE.length - 1;
    const next = (CUMULATIVE[last] as number) + speedForNextLevel(last);
    if (!Number.isFinite(next)) return;
    CUMULATIVE.push(next);
  }
};

/** Cumulative Speed needed to have REACHED `level`. Level 1 costs nothing. */
export const totalSpeedToReach = (level: number): number => {
  const target = Math.max(1, Math.floor(level));
  extendTo(target);
  return CUMULATIVE[Math.min(target, CUMULATIVE.length - 1)] ?? 0;
};

/** Where a lifetime Speed total sits on the level curve. */
export interface LevelProgress {
  /** Current level. Everyone starts at 1. */
  readonly level: number;
  /** Speed earned toward the next level. */
  readonly into: number;
  /** Speed needed for the next level. */
  readonly required: number;
  /** 0..1 fill for the level bar. */
  readonly fraction: number;
}

/** Resolve a lifetime Speed total into a level and a bar position. */
export const resolveLevel = (totalSpeed: number): LevelProgress => {
  const total = Number.isFinite(totalSpeed) ? Math.max(0, totalSpeed) : 0;

  // Grow the table until it reaches past this total, then binary search it
  // for the highest level whose cost is covered.
  while ((CUMULATIVE[CUMULATIVE.length - 1] as number) <= total) {
    const before = CUMULATIVE.length;
    extendTo(before + 64);
    if (CUMULATIVE.length === before) break;
  }
  let low = 1;
  let high = CUMULATIVE.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((CUMULATIVE[mid] as number) <= total) low = mid;
    else high = mid - 1;
  }
  const level = low;

  const required = speedForNextLevel(level);
  const into = total - (CUMULATIVE[level] as number);
  return {
    level,
    into,
    required,
    fraction: required > 0 ? Math.min(Math.max(into / required, 0), 1) : 0,
  };
};

/**
 * Compact display form used by the HUD: 940, 13.2K, 453.6K, 3.1M, 2.5B, 4T.
 *
 * Lives in shared so the server can log the figures the player sees.
 */
export const formatSpeed = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  const compact = (divisor: number, suffix: string): string => {
    const scaled = amount / divisor;
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
    return `${text}${suffix}`;
  };
  if (amount >= 1_000_000_000_000) return compact(1_000_000_000_000, 'T');
  if (amount >= 1_000_000_000) return compact(1_000_000_000, 'B');
  if (amount >= 1_000_000) return compact(1_000_000, 'M');
  if (amount >= 10_000) return compact(1_000, 'K');
  return Math.floor(amount).toLocaleString('en-US');
};

/** Wins, printed with thousands separators up to a million and compact past it. */
export const formatWins = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (amount < 1_000_000) return amount.toLocaleString('en-US');
  return formatSpeed(amount);
};
