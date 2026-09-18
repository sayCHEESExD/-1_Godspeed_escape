import { MAX_WINS } from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * The ONE place Wins are added or removed.
 *
 * Stages and Bux grants add them; the charm shop spends them; the upgrade,
 * trail and aura ladders only ever ASK whether a total is held. Wins are a
 * float64 on the wire, so every addition saturates at the largest exact
 * integer rather than losing precision.
 */
export const wallet = {
  add(player: PlayerState, amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = player.wins;
    player.wins = Math.min(MAX_WINS, Math.floor(before + amount));
    return player.wins - before;
  },

  /** True when the player HOLDS at least `required`. A gate, never a payment. */
  holds(player: PlayerState, required: number): boolean {
    if (!Number.isFinite(required) || required < 0) return false;
    return player.wins >= Math.floor(required);
  },

  canAfford(player: PlayerState, cost: number): boolean {
    return wallet.holds(player, cost);
  },

  /** Deduct Wins. False and unchanged when the player cannot afford it. */
  spend(player: PlayerState, cost: number): boolean {
    const price = Math.floor(Number.isFinite(cost) ? Math.max(0, cost) : 0);
    if (player.wins < price) return false;
    player.wins -= price;
    return true;
  },
};
