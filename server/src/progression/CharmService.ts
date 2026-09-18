import {
  CHARM_EQUIP_LIMIT,
  CHARM_SHOP,
  charmBySlot,
  charmMask,
  countMask,
  drawShelf,
  encodeShelf,
  isCharmOwned,
  type CharmDefinition,
} from '@godspeed/shared';
import type { ShopState } from '../rooms/state/CourseState.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';
import type { SpeedService } from './SpeedService.js';
import { wallet } from './Wallet.js';

const SCOPE = 'charms';

const PURCHASE_COOLDOWN_MS = 350;

export type BuyCharmResult =
  | { readonly ok: true; readonly charm: CharmDefinition; readonly winsAfter: number }
  | {
      readonly ok: false;
      readonly reason: 'bad-shelf' | 'not-stocked' | 'already-owned' | 'too-poor' | 'cooldown';
    };

export type EquipCharmResult =
  | { readonly ok: true; readonly slot: number }
  | { readonly ok: false; readonly reason: 'unknown-slot' | 'not-owned' | 'limit' };

/**
 * THE CHARM SHOP, process-wide.
 *
 * One shelf for every room on this server, restocked every five minutes with
 * three charms drawn at random. Process-wide rather than per room so two
 * players in two rooms see the same shop - it is a shop, not a loot roll -
 * and so a room that opens mid-cycle joins the countdown already running.
 */
class CharmShop {
  private shelf: number[] = drawShelf();
  private restockAt = Date.now() + CHARM_SHOP.restockSeconds * 1000;

  /** What is on the shelf now. Restocks first if it is time. */
  current(): readonly number[] {
    this.tick();
    return this.shelf;
  }

  /** Whole seconds until the next restock. */
  secondsLeft(): number {
    this.tick();
    return Math.max(0, Math.ceil((this.restockAt - Date.now()) / 1000));
  }

  /** Restock now. Exposed for the verifier; the shop otherwise restocks itself. */
  restock(): void {
    this.shelf = drawShelf();
    this.restockAt = Date.now() + CHARM_SHOP.restockSeconds * 1000;
    logger.info(SCOPE, `shop restocked: ${this.shelf.map((slot) => charmBySlot(slot)?.id).join(', ')}`);
  }

  private tick(): void {
    if (Date.now() < this.restockAt) return;
    this.restock();
  }
}

export const charmShop = new CharmShop();

/**
 * Server authority over charms: what is bought, what is worn.
 *
 * Buying is the ONE place in the game Wins are SPENT. A purchase names a shelf
 * position, never a charm and never a price: the server reads which charm is
 * on the shelf right now, takes the catalogue price through `Wallet`, and
 * grants the charm. Wearing is limited to `CHARM_EQUIP_LIMIT` at once.
 */
export class CharmService {
  private readonly lastPurchaseAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    this.lastPurchaseAt.delete(player.sessionId);
    this.sanitise(player);
  }

  forget(sessionId: string): void {
    this.lastPurchaseAt.delete(sessionId);
  }

  /** Write the shelf and the countdown onto the room's replicated shop. */
  publish(shop: ShopState): void {
    const shelf = encodeShelf(charmShop.current());
    if (shop.shelf !== shelf) shop.shelf = shelf;
    const left = charmShop.secondsLeft();
    if (shop.restockIn !== left) shop.restockIn = left;
  }

  buy(player: PlayerState, shelfIndex: unknown, speeds: SpeedService): BuyCharmResult {
    if (typeof shelfIndex !== 'number' || !Number.isInteger(shelfIndex)) {
      return { ok: false, reason: 'bad-shelf' };
    }
    const shelf = charmShop.current();
    const slot = shelf[shelfIndex];
    const charm = slot === undefined ? undefined : charmBySlot(slot);
    if (!charm) return { ok: false, reason: 'not-stocked' };

    if (isCharmOwned(player.ownedCharms, charm.slot)) return { ok: false, reason: 'already-owned' };
    if (!wallet.canAfford(player, charm.price)) return { ok: false, reason: 'too-poor' };

    const now = Date.now();
    if (now - (this.lastPurchaseAt.get(player.sessionId) ?? 0) < PURCHASE_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }

    if (!wallet.spend(player, charm.price)) return { ok: false, reason: 'too-poor' };
    this.lastPurchaseAt.set(player.sessionId, now);
    player.ownedCharms |= charmMask(charm.slot);
    // A fresh purchase is worn if there is room for it.
    if (countMask(player.equippedCharms) < CHARM_EQUIP_LIMIT) {
      player.equippedCharms |= charmMask(charm.slot);
    }
    speeds.syncDerived(player);
    return { ok: true, charm, winsAfter: player.wins };
  }

  equip(player: PlayerState, slot: unknown, speeds: SpeedService): EquipCharmResult {
    const charm = this.charmOf(slot);
    if (!charm) return { ok: false, reason: 'unknown-slot' };
    if (!isCharmOwned(player.ownedCharms, charm.slot)) return { ok: false, reason: 'not-owned' };
    if (isCharmOwned(player.equippedCharms, charm.slot)) return { ok: true, slot: charm.slot };
    if (countMask(player.equippedCharms) >= CHARM_EQUIP_LIMIT) return { ok: false, reason: 'limit' };
    player.equippedCharms |= charmMask(charm.slot);
    speeds.syncDerived(player);
    return { ok: true, slot: charm.slot };
  }

  unequip(player: PlayerState, slot: unknown, speeds: SpeedService): EquipCharmResult {
    const charm = this.charmOf(slot);
    if (!charm) return { ok: false, reason: 'unknown-slot' };
    player.equippedCharms &= ~charmMask(charm.slot);
    player.equippedCharms >>>= 0;
    speeds.syncDerived(player);
    return { ok: true, slot: charm.slot };
  }

  /** Drop worn charms the player turns out not to own, and any over the limit. */
  sanitise(player: PlayerState): void {
    let worn = (player.equippedCharms & player.ownedCharms) >>> 0;
    while (countMask(worn) > CHARM_EQUIP_LIMIT) {
      // Drop the highest bit until the limit holds.
      const highest = 31 - Math.clz32(worn);
      worn = (worn & ~(1 << highest)) >>> 0;
    }
    if (worn !== player.equippedCharms) player.equippedCharms = worn;
  }

  private charmOf(slot: unknown): CharmDefinition | undefined {
    if (typeof slot !== 'number' || !Number.isInteger(slot)) return undefined;
    return charmBySlot(slot);
  }
}
