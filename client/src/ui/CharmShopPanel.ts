import {
  CHARM_SHOP,
  charmBySlot,
  formatWins,
  isCharmOwned,
  rarityLabel,
} from '@godspeed/shared';
import type { ShopSnapshot } from '../net/netTypes.js';
import { ICONS, charmGlyph } from './hudStyles.js';
import { Panel } from './Panel.js';

interface Card {
  readonly element: HTMLDivElement;
  readonly rarity: HTMLDivElement;
  readonly icon: HTMLDivElement;
  readonly name: HTMLDivElement;
  readonly effect: HTMLDivElement;
  readonly button: HTMLButtonElement;
}

const css = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/**
 * THE CHARM SHOP: three shelves, restocked every five minutes.
 *
 * The shelf and the countdown are SERVER state, replicated to every client.
 * A purchase names a shelf position and nothing else - the server reads what
 * is on the shelf right now and takes the catalogue price.
 */
export class CharmShopPanel extends Panel {
  private readonly timer: HTMLDivElement;
  private readonly cards: Card[] = [];

  private shelf: readonly number[] = [];
  private restockIn = -1;
  private wins = 0;
  private ownedCharms = 0;
  private shelfKey = '';

  constructor(parent: HTMLElement, actions: { buy: (shelfIndex: number) => void }) {
    super(parent, 'shop', 'Charm Shop', ICONS.shop);

    this.timer = document.createElement('div');
    this.timer.className = 'aoe-shop__timer aoe-font';
    this.body.appendChild(this.timer);

    const grid = document.createElement('div');
    grid.className = 'aoe-shop__grid';
    for (let i = 0; i < CHARM_SHOP.slots; i += 1) {
      const element = document.createElement('div');
      element.className = 'aoe-charm';
      const rarity = document.createElement('div');
      rarity.className = 'aoe-charm__rarity aoe-font';
      const icon = document.createElement('div');
      icon.className = 'aoe-charm__icon';
      const name = document.createElement('div');
      name.className = 'aoe-charm__name aoe-font';
      const effect = document.createElement('div');
      effect.className = 'aoe-charm__effect aoe-font';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'aoe-row__buy aoe-charm__buy aoe-font';
      button.addEventListener('click', () => {
        if (button.disabled) return;
        actions.buy(i);
      });
      element.append(rarity, icon, name, effect, button);
      grid.appendChild(element);
      this.cards.push({ element, rarity, icon, name, effect, button });
    }
    this.body.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'aoe-panel__note';
    note.textContent = 'Charms are permanent. Wear them from the Backpack.';
    this.body.appendChild(note);

    this.render();
  }

  /** The replicated shelf. Cheap to call every frame: compared before drawing. */
  setShelf(shop: ShopSnapshot | null): void {
    if (!shop) return;
    const key = shop.shelf.join(',');
    const changed = key !== this.shelfKey || shop.restockIn !== this.restockIn;
    if (!changed) return;
    this.shelfKey = key;
    this.shelf = shop.shelf;
    this.restockIn = shop.restockIn;
    this.render();
  }

  setInventory(wins: number, ownedCharms: number): void {
    if (wins === this.wins && ownedCharms === this.ownedCharms) return;
    this.wins = wins;
    this.ownedCharms = ownedCharms;
    this.render();
  }

  /** True when a charm on the shelf can be bought right now. */
  get hasAffordable(): boolean {
    return this.shelf.some((slot) => {
      const charm = charmBySlot(slot);
      return charm !== undefined && !isCharmOwned(this.ownedCharms, slot) && this.wins >= charm.price;
    });
  }

  protected override onOpened(): void {
    this.render();
  }

  private render(): void {
    const minutes = Math.floor(Math.max(0, this.restockIn) / 60);
    const seconds = Math.max(0, this.restockIn) % 60;
    this.timer.innerHTML =
      this.restockIn < 0
        ? 'Connecting to the shop…'
        : `Restocks in <b>${minutes}:${seconds.toString().padStart(2, '0')}</b>`;

    for (let i = 0; i < this.cards.length; i += 1) {
      const card = this.cards[i] as Card;
      const slot = this.shelf[i];
      const charm = slot === undefined ? undefined : charmBySlot(slot);
      card.element.className = 'aoe-charm';
      if (!charm) {
        card.element.classList.add('aoe-charm--empty');
        card.rarity.textContent = 'Sold out';
        card.icon.innerHTML = '';
        card.name.textContent = '';
        card.effect.textContent = '';
        card.button.textContent = '—';
        card.button.disabled = true;
        continue;
      }
      card.element.classList.add(`aoe-charm--${charm.rarity}`);
      card.rarity.textContent = rarityLabel(charm.rarity);
      card.icon.innerHTML = charmGlyph(charm.glyph, css(charm.color));
      card.name.textContent = charm.name;
      card.effect.textContent =
        charm.effect.kind === 'speed'
          ? `+${charm.effect.percent}% speed`
          : `+${charm.effect.percent}% sprint duration`;
      const owned = isCharmOwned(this.ownedCharms, charm.slot);
      if (owned) {
        card.button.textContent = 'Owned';
        card.button.disabled = true;
      } else {
        card.button.innerHTML = `${ICONS.trophy}<span>${formatWins(charm.price)}</span>`;
        card.button.disabled = this.wins < charm.price;
      }
    }
  }
}
