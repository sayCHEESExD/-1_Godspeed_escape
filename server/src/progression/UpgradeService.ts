import {
  bestOwnedUpgrade,
  ownsUpgrade,
  upgradeBit,
  upgradeForSlot,
  upgradeTileAt,
  type SpeedUpgrade,
} from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { SpeedService } from './SpeedService.js';
import { wallet } from './Wallet.js';

export interface UpgradeClaim {
  readonly granted: boolean;
  readonly tier: SpeedUpgrade | null;
  readonly reason?: 'unknown-slot' | 'not-on-tile' | 'already-owned' | 'too-few-wins' | 'cooldown';
}

/** Milliseconds between two accepted unlocks from one player. Spam only. */
const CLAIM_COOLDOWN_MS = 250;

/**
 * Server authority over the speed upgrades.
 *
 * Unlocking is a DELIBERATE ACT: the player walks onto the tile in the hub.
 * The position is checked against the transform the server itself simulated,
 * the Wins requirement is a GATE that is checked and never spent, and the
 * best tier owned is always the one equipped - so an unlock can never be a
 * downgrade and there is no separate "equip upgrade" request.
 */
export class UpgradeService {
  private readonly lastClaimAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    this.lastClaimAt.set(player.sessionId, 0);
    this.equipBest(player);
  }

  forget(sessionId: string): void {
    this.lastClaimAt.delete(sessionId);
  }

  claim(player: PlayerState, slot: number, speeds: SpeedService): UpgradeClaim {
    const requested = Math.floor(slot);
    const tier = upgradeForSlot(requested);
    if (tier.slot !== requested) return { granted: false, tier: null, reason: 'unknown-slot' };

    if (upgradeTileAt(player.x, player.y, player.z) !== tier.slot) {
      return { granted: false, tier, reason: 'not-on-tile' };
    }
    if (ownsUpgrade(player.ownedUpgrades, tier.slot)) {
      return { granted: false, tier, reason: 'already-owned' };
    }
    if (!wallet.holds(player, tier.winsRequired)) {
      return { granted: false, tier, reason: 'too-few-wins' };
    }

    const now = Date.now();
    if (now - (this.lastClaimAt.get(player.sessionId) ?? 0) < CLAIM_COOLDOWN_MS) {
      return { granted: false, tier, reason: 'cooldown' };
    }
    // The tile is BOUGHT: its Wins leave the wallet. Last, so a refusal above
    // never costs anything.
    if (!wallet.spend(player, tier.winsRequired)) {
      return { granted: false, tier, reason: 'too-few-wins' };
    }

    player.ownedUpgrades |= upgradeBit(tier.slot);
    this.lastClaimAt.set(player.sessionId, now);
    this.equipBest(player);
    speeds.syncDerived(player);

    return { granted: true, tier };
  }

  /** Equip the best tier owned. Never a downgrade. */
  equipBest(player: PlayerState): void {
    player.upgradeSlot = bestOwnedUpgrade(player.ownedUpgrades).slot;
  }
}
