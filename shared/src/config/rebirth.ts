/**
 * Rebirth: the prestige ladder.
 *
 * A rebirth trades the current level curve for a permanently bigger Speed
 * multiplier, and leaves everything the player earned OUTSIDE that curve
 * alone: Wins, speed upgrades, trails, auras and charms are permanent unlocks
 * and survive a rebirth untouched.
 *
 * As specified: rebirth 0 is x1, rebirth 1 is x1.5, rebirth 2 is x2, and every
 * rebirth after adds another 0.5. The first is available at level 15; the
 * requirements climb from there and keep climbing - THERE IS NO LEVEL CAP.
 */

/** Speed multiplier added per rebirth. */
export const MULTIPLIER_PER_REBIRTH = 0.5;

/**
 * Level required for rebirth N (1-based), for the authored head of the ladder.
 *
 * 15, then a big step to the forties, then seventy-five and up, as specified.
 * Past the table the requirement keeps growing by `LEVEL_STEP_AFTER_LADDER`.
 */
export const REBIRTH_REQUIRED_LEVELS: readonly number[] = [15, 45, 75, 110, 150, 200];

/** Levels added to the requirement for every rebirth past the authored ladder. */
export const LEVEL_STEP_AFTER_LADDER = 60;

/** The largest rebirth count that can be replicated (a uint32 field). */
export const MAX_REPLICATED_REBIRTHS = 4294967295;

/** Level the NEXT rebirth needs, given how many have been performed. */
export const rebirthRequiredLevel = (count: number): number => {
  const done = Math.max(0, Math.floor(count));
  const authored = REBIRTH_REQUIRED_LEVELS[done];
  if (authored !== undefined) return authored;
  const lastIndex = REBIRTH_REQUIRED_LEVELS.length - 1;
  return (REBIRTH_REQUIRED_LEVELS[lastIndex] as number) + LEVEL_STEP_AFTER_LADDER * (done - lastIndex);
};

/** Speed multiplier granted by `count` completed rebirths. */
export const rebirthMultiplier = (count: number): number => {
  const done = Math.max(0, Math.floor(count));
  return 1 + done * MULTIPLIER_PER_REBIRTH;
};

/** A player may rebirth once they have reached the level the next rung needs. */
export const canRebirth = (level: number, count: number): boolean =>
  Math.floor(level) >= rebirthRequiredLevel(count);
