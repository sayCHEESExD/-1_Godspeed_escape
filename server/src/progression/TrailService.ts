import { isTrailOwned, trailBySlot, trailMask, type TrailTier } from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { SpeedService } from './SpeedService.js';
import { wallet } from './Wallet.js';

const UNLOCK_COOLDOWN_MS = 350;

export type UnlockTrailResult =
  | { readonly ok: true; readonly tier: TrailTier }
  | { readonly ok: false; readonly reason: 'unknown-slot' | 'already-owned' | 'too-few-wins' | 'cooldown' };

export type EquipTrailResult =
  | { readonly ok: true; readonly slot: number }
  | { readonly ok: false; readonly reason: 'unknown-slot' | 'not-owned' };

/**
 * Server authority over trails.
 *
 * The slot must exist, it must not already be owned, the Wins requirement
 * must be MET (it is a gate; nothing is spent), and equipping is refused
 * outright for anything the player does not own. The client sends a slot
 * number and nothing else.
 */
export class TrailService {
  private readonly lastUnlockAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    this.lastUnlockAt.delete(player.sessionId);
    this.sanitise(player);
  }

  forget(sessionId: string): void {
    this.lastUnlockAt.delete(sessionId);
  }

  unlock(player: PlayerState, slot: unknown, speeds: SpeedService): UnlockTrailResult {
    const tier = this.tierOf(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };
    if (isTrailOwned(player.ownedTrails, tier.slot)) return { ok: false, reason: 'already-owned' };
    if (!wallet.holds(player, tier.winsRequired)) return { ok: false, reason: 'too-few-wins' };

    const now = Date.now();
    if (now - (this.lastUnlockAt.get(player.sessionId) ?? 0) < UNLOCK_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }

    this.lastUnlockAt.set(player.sessionId, now);
    player.ownedTrails |= trailMask(tier.slot);
    // A fresh unlock equips itself: the player asked for it.
    player.trailSlot = tier.slot;
    speeds.syncDerived(player);
    return { ok: true, tier };
  }

  equip(player: PlayerState, slot: unknown, speeds: SpeedService): EquipTrailResult {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) return { ok: false, reason: 'unknown-slot' };
    if (slot === 0) {
      player.trailSlot = 0;
      speeds.syncDerived(player);
      return { ok: true, slot: 0 };
    }
    const tier = this.tierOf(slot);
    if (!tier) return { ok: false, reason: 'unknown-slot' };
    if (!isTrailOwned(player.ownedTrails, tier.slot)) return { ok: false, reason: 'not-owned' };
    player.trailSlot = tier.slot;
    speeds.syncDerived(player);
    return { ok: true, slot: tier.slot };
  }

  /** Drop a worn trail the player turns out not to own. */
  sanitise(player: PlayerState): void {
    if (player.trailSlot === 0) return;
    if (!isTrailOwned(player.ownedTrails, player.trailSlot)) player.trailSlot = 0;
  }

  private tierOf(slot: unknown): TrailTier | undefined {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) return undefined;
    return trailBySlot(slot);
  }
}
