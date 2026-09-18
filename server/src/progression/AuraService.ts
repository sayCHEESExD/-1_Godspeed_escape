import { auraBySlot, auraMask, isAuraOwned, type AuraTier } from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { SpeedService } from './SpeedService.js';
import { wallet } from './Wallet.js';

const UNLOCK_COOLDOWN_MS = 350;

export type UnlockAuraResult =
  | { readonly ok: true; readonly tier: AuraTier }
  | { readonly ok: false; readonly reason: 'unknown-slot' | 'already-owned' | 'too-few-wins' | 'cooldown' };

export type EquipAuraResult =
  | { readonly ok: true; readonly slot: number }
  | { readonly ok: false; readonly reason: 'unknown-slot' | 'not-owned' };

/**
 * Server authority over auras. The mirror of `TrailService`: a Wins GATE to
 * unlock, ownership checked to equip, one worn at a time.
 */
export class AuraService {
  private readonly lastUnlockAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    this.lastUnlockAt.delete(player.sessionId);
    this.sanitise(player);
  }

  forget(sessionId: string): void {
    this.lastUnlockAt.delete(sessionId);
  }

  unlock(player: PlayerState, slot: unknown, speeds: SpeedService): UnlockAuraResult {
    const tier = this.tierOf(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };
    if (isAuraOwned(player.ownedAuras, tier.slot)) return { ok: false, reason: 'already-owned' };
    if (!wallet.holds(player, tier.winsRequired)) return { ok: false, reason: 'too-few-wins' };

    const now = Date.now();
    if (now - (this.lastUnlockAt.get(player.sessionId) ?? 0) < UNLOCK_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }
    // BOUGHT: the Wins leave the wallet. Last, so a refusal above costs nothing.
    if (!wallet.spend(player, tier.winsRequired)) return { ok: false, reason: 'too-few-wins' };

    this.lastUnlockAt.set(player.sessionId, now);
    player.ownedAuras |= auraMask(tier.slot);
    player.auraSlot = tier.slot;
    speeds.syncDerived(player);
    return { ok: true, tier };
  }

  equip(player: PlayerState, slot: unknown, speeds: SpeedService): EquipAuraResult {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) return { ok: false, reason: 'unknown-slot' };
    if (slot === 0) {
      player.auraSlot = 0;
      speeds.syncDerived(player);
      return { ok: true, slot: 0 };
    }
    const tier = this.tierOf(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };
    if (!isAuraOwned(player.ownedAuras, tier.slot)) return { ok: false, reason: 'not-owned' };
    player.auraSlot = tier.slot;
    speeds.syncDerived(player);
    return { ok: true, slot: tier.slot };
  }

  sanitise(player: PlayerState): void {
    if (player.auraSlot === 0) return;
    if (!isAuraOwned(player.ownedAuras, player.auraSlot)) player.auraSlot = 0;
  }

  private tierOf(slot: unknown): AuraTier | undefined {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) return undefined;
    return auraBySlot(slot);
  }
}
