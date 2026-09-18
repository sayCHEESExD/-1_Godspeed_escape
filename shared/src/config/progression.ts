import { rebirthMultiplier } from './rebirth.js';

/**
 * Progression tuning. Level, Speed, Wins, rebirths, upgrades, trails, auras and
 * charms are all SERVER-AUTHORITATIVE; the client may predict for UI feel but
 * never decides any of them.
 */

/**
 * The largest Wins total that can be held.
 *
 * `PlayerState.wins` is a `float64`, because the unlock ladders run to
 * trillions and a uint32 wraps at four billion. This is the largest integer
 * that is still exact, and every path that adds Wins saturates at it.
 */
export const MAX_WINS = Number.MAX_SAFE_INTEGER;

export { rebirthMultiplier };
