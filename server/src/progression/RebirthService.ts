import { canRebirth, rebirthMultiplier, rebirthRequiredLevel } from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { SpeedService } from './SpeedService.js';

export type RebirthResult =
  | { readonly ok: true; readonly rebirths: number; readonly multiplier: number }
  | { readonly ok: false; readonly reason: 'not-eligible' };

/**
 * Server authority over rebirths.
 *
 * A rebirth trades the current level curve for a permanently bigger Speed
 * multiplier. What it must NOT touch is anything the player earned OUTSIDE
 * that curve: Wins, speed upgrades, trails, auras and charms are permanent
 * unlocks and survive untouched.
 *
 * The client sends an empty message. Eligibility is decided here from the
 * server's own level and rebirth count.
 */
export class RebirthService {
  isEligible(player: PlayerState): boolean {
    return canRebirth(player.level, player.rebirths);
  }

  requiredLevel(player: PlayerState): number {
    return rebirthRequiredLevel(player.rebirths);
  }

  rebirth(player: PlayerState, speeds: SpeedService): RebirthResult {
    if (!this.isEligible(player)) return { ok: false, reason: 'not-eligible' };

    player.rebirths += 1;
    // Level FOLLOWS from lifetime Speed, so clearing the Speed total is what
    // actually returns the player to level 1.
    player.totalSpeed = 0;
    player.level = 1;
    speeds.syncDerived(player);

    return {
      ok: true,
      rebirths: player.rebirths,
      multiplier: rebirthMultiplier(player.rebirths),
    };
  }
}
