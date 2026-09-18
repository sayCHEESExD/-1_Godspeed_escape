/**
 * Charms, and the CHARM SHOP that sells them.
 *
 * A charm is a small permanent bonus: a percentage on Speed per step, or a
 * percentage on how long a sprint lasts. They are BOUGHT - the one thing in
 * the game that spends Wins - from a shop that restocks every five minutes
 * with three charms drawn at random from this catalogue.
 *
 * The catalogue is pure data. Adding a charm is a new row: the shop draws from
 * the table, the server applies `effect` through one function, and the
 * backpack draws whatever `rarity` and `effect` say. The one hard ceiling is
 * that a charm's slot must be at most 31, because ownership is a uint32 mask.
 */

export type CharmRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type CharmEffectKind =
  /** Percent added to Speed per step. */
  | 'speed'
  /** Percent added to sprint duration (the bar drains that much slower). */
  | 'sprint';

export interface CharmEffect {
  readonly kind: CharmEffectKind;
  /** Whole percent. `+7` is seven percent. */
  readonly percent: number;
}

export interface CharmDefinition {
  /** 1-based, stable, never reused: it is the bit in the owned mask. */
  readonly slot: number;
  /** Stable id for saves and logs. */
  readonly id: string;
  readonly name: string;
  readonly rarity: CharmRarity;
  readonly effect: CharmEffect;
  /** Wins SPENT on purchase. */
  readonly price: number;
  /** Icon colour, as a hex integer. */
  readonly color: number;
  /** Which little glyph the backpack draws. */
  readonly glyph: 'shield' | 'flame' | 'star' | 'feather' | 'bolt' | 'heart' | 'crown' | 'wing';
}

export const CHARMS: readonly CharmDefinition[] = [
  { slot: 1, id: 'endurance_shield', name: 'Endurance Shield', rarity: 'epic',
    effect: { kind: 'sprint', percent: 7 }, price: 250_000, color: 0x9bd4ff, glyph: 'shield' },
  { slot: 2, id: 'blue_flame', name: 'Blue Flame', rarity: 'rare',
    effect: { kind: 'speed', percent: 6 }, price: 25_000, color: 0x35e0ff, glyph: 'flame' },
  { slot: 3, id: 'star', name: 'Star', rarity: 'rare',
    effect: { kind: 'speed', percent: 3 }, price: 25_000, color: 0xffe066, glyph: 'star' },
  { slot: 4, id: 'swift_feather', name: 'Swift Feather', rarity: 'common',
    effect: { kind: 'sprint', percent: 2 }, price: 2_500, color: 0xdff6ff, glyph: 'feather' },
  { slot: 5, id: 'ember', name: 'Ember', rarity: 'common',
    effect: { kind: 'speed', percent: 1 }, price: 2_500, color: 0xff9f2e, glyph: 'flame' },
  { slot: 6, id: 'lightning_bolt', name: 'Lightning Bolt', rarity: 'epic',
    effect: { kind: 'speed', percent: 10 }, price: 500_000, color: 0xfff176, glyph: 'bolt' },
  { slot: 7, id: 'phoenix_heart', name: 'Phoenix Heart', rarity: 'legendary',
    effect: { kind: 'speed', percent: 15 }, price: 5_000_000, color: 0xff3d6a, glyph: 'heart' },
  { slot: 8, id: 'aegis', name: 'Aegis', rarity: 'legendary',
    effect: { kind: 'sprint', percent: 12 }, price: 5_000_000, color: 0xffc51f, glyph: 'shield' },
  { slot: 9, id: 'olympus_crown', name: 'Olympus Crown', rarity: 'mythic',
    effect: { kind: 'speed', percent: 25 }, price: 100_000_000, color: 0xffd54a, glyph: 'crown' },
  { slot: 10, id: 'wings_of_hermes', name: 'Wings of Hermes', rarity: 'mythic',
    effect: { kind: 'sprint', percent: 20 }, price: 100_000_000, color: 0xffffff, glyph: 'wing' },
];

/** Slots must fit a uint32 mask, and `1 << 31` is negative in JavaScript. */
export const MAX_CHARM_SLOTS = 31;

/** How many charms may be WORN at once. */
export const CHARM_EQUIP_LIMIT = 3;

export const CHARM_SHOP = {
  /** Seconds between restocks. Five minutes, as specified. */
  restockSeconds: 300,
  /** How many charms each restock puts on the shelf. */
  slots: 3,
} as const;

/**
 * Rarity weights for the restock draw.
 *
 * A mythic turns up, but rarely: the shelf is mostly commons and rares with
 * something worth waiting for every few restocks.
 */
export const RARITY_WEIGHT: Readonly<Record<CharmRarity, number>> = {
  common: 40,
  rare: 30,
  epic: 18,
  legendary: 9,
  mythic: 3,
};

export const charmBySlot = (slot: number): CharmDefinition | undefined =>
  CHARMS.find((charm) => charm.slot === slot);

export const charmMask = (slot: number): number => 1 << (Math.floor(slot) - 1);

export const isCharmOwned = (owned: number, slot: number): boolean =>
  (owned & charmMask(slot)) !== 0;

/** How many bits of a mask are set: the number of charms worn. */
export const countMask = (mask: number): number => {
  let count = 0;
  let bits = mask >>> 0;
  while (bits) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
};

/** The combined bonuses of every charm in a WORN mask, gated by ownership. */
export interface CharmBonuses {
  /** Multiplier on Speed per step: 1.09 for +9%. */
  readonly speed: number;
  /** Multiplier on sprint capacity: 1.07 for +7%. */
  readonly sprint: number;
}

/**
 * Resolve every worn charm into two multipliers.
 *
 * Percentages ADD within a kind (two +3% speed charms are +6%), and a charm
 * that is worn but not owned counts for nothing, so a forged mask can only
 * ever mean no bonus.
 */
export const charmBonuses = (equipped: number, owned: number): CharmBonuses => {
  let speed = 0;
  let sprint = 0;
  for (const charm of CHARMS) {
    if (!isCharmOwned(equipped, charm.slot)) continue;
    if (!isCharmOwned(owned, charm.slot)) continue;
    if (charm.effect.kind === 'speed') speed += charm.effect.percent;
    else sprint += charm.effect.percent;
  }
  return { speed: 1 + speed / 100, sprint: 1 + sprint / 100 };
};

/**
 * Draw a shelf of `CHARM_SHOP.slots` distinct charms.
 *
 * Weighted by rarity, without replacement, from a caller-supplied random so
 * the verifier can seed it. Deterministic in shape: always the shelf size,
 * always distinct, never a slot the catalogue does not have.
 */
export const drawShelf = (random: () => number = Math.random): number[] => {
  const pool = CHARMS.map((charm) => charm);
  const shelf: number[] = [];
  while (shelf.length < CHARM_SHOP.slots && pool.length > 0) {
    let total = 0;
    for (const charm of pool) total += RARITY_WEIGHT[charm.rarity];
    let roll = random() * total;
    let picked = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= RARITY_WEIGHT[(pool[i] as CharmDefinition).rarity];
      if (roll <= 0) {
        picked = i;
        break;
      }
    }
    const charm = pool.splice(picked, 1)[0] as CharmDefinition;
    shelf.push(charm.slot);
  }
  return shelf;
};

/** The shelf as it crosses the wire: slots joined by commas. */
export const encodeShelf = (slots: readonly number[]): string => slots.join(',');

export const decodeShelf = (encoded: string): number[] =>
  encoded
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((slot) => Number.isFinite(slot) && charmBySlot(slot) !== undefined);

/** Display casing for a rarity word. */
export const rarityLabel = (rarity: CharmRarity): string =>
  rarity.charAt(0).toUpperCase() + rarity.slice(1);
