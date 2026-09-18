import {
  AURA_TIERS,
  CHARMS,
  CHARM_EQUIP_LIMIT,
  TRAIL_TIERS,
  countMask,
  formatStep,
  formatWins,
  isAuraOwned,
  isCharmOwned,
  isTrailOwned,
  rarityLabel,
  type CharmDefinition,
} from '@godspeed/shared';
import { ICONS, charmGlyph } from './hudStyles.js';
import { Panel } from './Panel.js';

type Tab = 'trails' | 'auras' | 'charms';

interface Row {
  readonly tab: Tab;
  readonly slot: number;
  readonly element: HTMLDivElement;
  readonly button: HTMLButtonElement;
}

export interface BackpackInventory {
  wins: number;
  ownedTrails: number;
  trailSlot: number;
  ownedAuras: number;
  auraSlot: number;
  ownedCharms: number;
  equippedCharms: number;
}

export interface BackpackActions {
  unlockTrail(slot: number): void;
  equipTrail(slot: number): void;
  unlockAura(slot: number): void;
  equipAura(slot: number): void;
  equipCharm(slot: number, wear: boolean): void;
}

const css = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/**
 * Owned charms, most valuable first.
 *
 * "Best" is what the shop says it is: the dearest charm first, then the larger
 * effect, then Speed before sprint. Rarity and price rise together in the
 * catalogue, so this is also rarest-first.
 */
const byValue = (a: CharmDefinition, b: CharmDefinition): number => {
  if (b.price !== a.price) return b.price - a.price;
  if (b.effect.percent !== a.effect.percent) return b.effect.percent - a.effect.percent;
  if (a.effect.kind === b.effect.kind) return 0;
  return a.effect.kind === 'speed' ? -1 : 1;
};

/**
 * THE BACKPACK: Trails, Auras and Charms, on three tabs.
 *
 * Every row only ever ASKS. The server owns the wallet and every inventory,
 * and this renders whatever comes back. A trail or aura row says what it
 * requires and unlocks with a tap once the player HOLDS that many Wins; a
 * charm row wears or removes something the player has bought in the shop.
 */
export class BackpackPanel extends Panel {
  private readonly rows: Row[] = [];
  private readonly lists: Record<Tab, HTMLDivElement>;
  private readonly tabs: Record<Tab, HTMLButtonElement>;
  private readonly charmNote: HTMLParagraphElement;
  private readonly equipBestButton: HTMLButtonElement;
  private readonly unequipAllButton: HTMLButtonElement;
  private active: Tab = 'trails';

  private inventory: BackpackInventory = {
    wins: 0,
    ownedTrails: 0,
    trailSlot: 0,
    ownedAuras: 0,
    auraSlot: 0,
    ownedCharms: 0,
    equippedCharms: 0,
  };

  constructor(parent: HTMLElement, actions: BackpackActions) {
    super(parent, 'backpack', 'Backpack', ICONS.backpack);

    const bar = document.createElement('div');
    bar.className = 'aoe-tabs';
    this.tabs = {
      trails: this.tab(bar, 'trails', 'Trails', ICONS.trail),
      auras: this.tab(bar, 'auras', 'Auras', ICONS.aura),
      charms: this.tab(bar, 'charms', 'Charms', ICONS.charm),
    };
    this.body.appendChild(bar);

    this.lists = {
      trails: document.createElement('div'),
      auras: document.createElement('div'),
      charms: document.createElement('div'),
    };

    const trailNote = this.note('Trails add flat Speed to every step. Unlock by reaching the Wins shown.');
    this.lists.trails.appendChild(trailNote);
    for (const tier of TRAIL_TIERS) {
      this.addRow(this.lists.trails, 'trails', tier.slot, tier.name, `+${formatStep(tier.bonus)} speed`, css(tier.color), () => {
        if (isTrailOwned(this.inventory.ownedTrails, tier.slot)) {
          actions.equipTrail(this.inventory.trailSlot === tier.slot ? 0 : tier.slot);
        } else {
          actions.unlockTrail(tier.slot);
        }
      });
    }

    const auraNote = this.note('Auras multiply the Speed of every step. Unlock by reaching the Wins shown.');
    this.lists.auras.appendChild(auraNote);
    for (const tier of AURA_TIERS) {
      this.addRow(this.lists.auras, 'auras', tier.slot, tier.name, `x${tier.multiplier} speed`, css(tier.color), () => {
        if (isAuraOwned(this.inventory.ownedAuras, tier.slot)) {
          actions.equipAura(this.inventory.auraSlot === tier.slot ? 0 : tier.slot);
        } else {
          actions.unlockAura(tier.slot);
        }
      });
    }

    this.charmNote = this.note('');
    this.lists.charms.appendChild(this.charmNote);

    // One tap to wear the best of what is owned, one to take everything off.
    // Both go through the same equip messages as the rows below them.
    const charmActions = document.createElement('div');
    charmActions.className = 'aoe-actions';
    this.equipBestButton = this.actionButton(charmActions, 'Equip Best', () => this.equipBest(actions));
    this.unequipAllButton = this.actionButton(charmActions, 'Unequip All', () => this.unequipAll(actions));
    this.unequipAllButton.classList.add('aoe-row__buy--equipped');
    this.lists.charms.appendChild(charmActions);

    for (const charm of CHARMS) {
      const effect = charm.effect.kind === 'speed'
        ? `+${charm.effect.percent}% speed`
        : `+${charm.effect.percent}% sprint duration`;
      this.addRow(
        this.lists.charms,
        'charms',
        charm.slot,
        `${rarityLabel(charm.rarity)} ${charm.name}`,
        effect,
        css(charm.color),
        () => {
          if (!isCharmOwned(this.inventory.ownedCharms, charm.slot)) return;
          actions.equipCharm(charm.slot, !isCharmOwned(this.inventory.equippedCharms, charm.slot));
        },
        charmGlyph(charm.glyph, css(charm.color)),
      );
    }

    this.body.append(this.lists.trails, this.lists.auras, this.lists.charms);
    this.showTab('trails');
    this.render();
  }

  setInventory(inventory: BackpackInventory): void {
    const same = (Object.keys(inventory) as (keyof BackpackInventory)[]).every(
      (key) => inventory[key] === this.inventory[key],
    );
    if (same) return;
    this.inventory = { ...inventory };
    this.render();
  }

  /** True when something can be unlocked right now. Drives the rail badge. */
  get hasUnlockable(): boolean {
    const { wins, ownedTrails, ownedAuras } = this.inventory;
    return (
      TRAIL_TIERS.some((t) => !isTrailOwned(ownedTrails, t.slot) && wins >= t.winsRequired) ||
      AURA_TIERS.some((t) => !isAuraOwned(ownedAuras, t.slot) && wins >= t.winsRequired)
    );
  }

  protected override onOpened(): void {
    this.render();
  }

  /** The charm slots Equip Best would leave worn: the most valuable owned, up to the limit. */
  private bestCharmSlots(): number[] {
    return CHARMS.filter((charm) => isCharmOwned(this.inventory.ownedCharms, charm.slot))
      .sort(byValue)
      .slice(0, CHARM_EQUIP_LIMIT)
      .map((charm) => charm.slot);
  }

  private equipBest(actions: BackpackActions): void {
    const best = this.bestCharmSlots();
    const keep = new Set(best);
    const worn = this.inventory.equippedCharms;
    // Take off what does not make the cut FIRST, so the limit has room.
    for (const charm of CHARMS) {
      if (isCharmOwned(worn, charm.slot) && !keep.has(charm.slot)) actions.equipCharm(charm.slot, false);
    }
    for (const slot of best) {
      if (!isCharmOwned(worn, slot)) actions.equipCharm(slot, true);
    }
  }

  private unequipAll(actions: BackpackActions): void {
    for (const charm of CHARMS) {
      if (isCharmOwned(this.inventory.equippedCharms, charm.slot)) actions.equipCharm(charm.slot, false);
    }
  }

  private tab(bar: HTMLDivElement, tab: Tab, label: string, iconHtml: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `aoe-tab aoe-tab--${tab} aoe-font`;
    button.innerHTML = `${iconHtml}<span class="aoe-outline">${label}</span>`;
    button.addEventListener('click', () => this.showTab(tab));
    bar.appendChild(button);
    return button;
  }

  private actionButton(bar: HTMLDivElement, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aoe-row__buy aoe-font';
    button.textContent = label;
    button.addEventListener('click', onClick);
    bar.appendChild(button);
    return button;
  }

  private showTab(tab: Tab): void {
    this.active = tab;
    for (const key of ['trails', 'auras', 'charms'] as const) {
      this.lists[key].hidden = key !== tab;
      this.tabs[key].classList.toggle('aoe-tab--active', key === tab);
    }
  }

  private note(text: string): HTMLParagraphElement {
    const node = document.createElement('p');
    node.className = 'aoe-panel__note';
    node.textContent = text;
    return node;
  }

  private addRow(
    list: HTMLDivElement,
    tab: Tab,
    slot: number,
    name: string,
    effect: string,
    color: string,
    onClick: () => void,
    glyphHtml?: string,
  ): void {
    const element = document.createElement('div');
    element.className = 'aoe-row';

    const swatch = document.createElement('div');
    swatch.className = 'aoe-row__swatch';
    swatch.style.background = `linear-gradient(180deg, ${color}, ${color}aa)`;
    if (glyphHtml) swatch.innerHTML = glyphHtml;

    const text = document.createElement('div');
    text.className = 'aoe-row__text';
    const title = document.createElement('div');
    title.className = 'aoe-row__name';
    title.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'aoe-row__meta aoe-row__meta--speed';
    meta.textContent = effect;
    text.append(title, meta);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aoe-row__buy aoe-font';
    button.addEventListener('click', onClick);

    element.append(swatch, text, button);
    list.appendChild(element);
    this.rows.push({ tab, slot, element, button });
  }

  private render(): void {
    const inv = this.inventory;
    const worn = countMask(inv.equippedCharms);
    this.charmNote.textContent =
      `Charms are bought in the Shop. Wear up to ${CHARM_EQUIP_LIMIT} at once (${worn}/${CHARM_EQUIP_LIMIT} worn).`;

    const best = this.bestCharmSlots();
    const alreadyBest =
      best.length === worn && best.every((slot) => isCharmOwned(inv.equippedCharms, slot));
    this.equipBestButton.disabled = best.length === 0 || alreadyBest;
    this.unequipAllButton.disabled = worn === 0;

    for (const row of this.rows) {
      let owned = false;
      let equipped = false;
      let required = 0;
      if (row.tab === 'trails') {
        const tier = TRAIL_TIERS.find((t) => t.slot === row.slot);
        if (!tier) continue;
        owned = isTrailOwned(inv.ownedTrails, tier.slot);
        equipped = inv.trailSlot === tier.slot;
        required = tier.winsRequired;
      } else if (row.tab === 'auras') {
        const tier = AURA_TIERS.find((t) => t.slot === row.slot);
        if (!tier) continue;
        owned = isAuraOwned(inv.ownedAuras, tier.slot);
        equipped = inv.auraSlot === tier.slot;
        required = tier.winsRequired;
      } else {
        owned = isCharmOwned(inv.ownedCharms, row.slot);
        equipped = isCharmOwned(inv.equippedCharms, row.slot);
      }

      row.element.classList.toggle('aoe-row--owned', owned && !equipped);
      row.element.classList.toggle('aoe-row--equipped', equipped);
      row.element.classList.toggle('aoe-row--locked', !owned);
      row.button.classList.toggle('aoe-row__buy--equipped', equipped);

      if (equipped) {
        row.button.textContent = row.tab === 'charms' ? 'Worn' : 'Equipped';
        row.button.disabled = false;
      } else if (owned) {
        row.button.textContent = 'Equip';
        row.button.disabled = row.tab === 'charms' && worn >= CHARM_EQUIP_LIMIT;
      } else if (row.tab === 'charms') {
        row.button.textContent = 'Shop';
        row.button.disabled = true;
      } else {
        row.button.innerHTML = `${ICONS.trophy}<span>${required === 0 ? 'Free' : formatWins(required)}</span>`;
        row.button.disabled = inv.wins < required;
      }
    }
  }
}
