/**
 * Auras: the Speed MULTIPLIER ladder, in the Backpack.
 *
 * An aura multiplies the Speed each step is worth, through the one shared
 * rate formula. Six tiers exactly as specified, unlocked by REACHING a Wins
 * total and worn one at a time. It visibly surrounds the player - a ring of
 * divine light - and it is drawn for every player in the room, so the effect
 * is budgeted for fifteen of them.
 */

export type AuraStyle = 'ring' | 'wings' | 'storm' | 'crown' | 'nova' | 'divine';

export interface AuraTier {
  readonly slot: number;
  readonly name: string;
  /** Multiplier on Speed per step while worn. */
  readonly multiplier: number;
  /** Wins the unlock COSTS. Spent from the wallet when it is bought. */
  readonly winsRequired: number;
  readonly color: number;
  readonly style: AuraStyle;
}

export const AURA_TIERS: readonly AuraTier[] = [
  { slot: 1, name: 'Blessed Ring', multiplier: 1.5, winsRequired: 1_000, color: 0xffe066, style: 'ring' },
  { slot: 2, name: 'Angel Wings', multiplier: 2, winsRequired: 30_000, color: 0xdff6ff, style: 'wings' },
  { slot: 3, name: 'Storm Mantle', multiplier: 3, winsRequired: 700_000, color: 0x8fd0ff, style: 'storm' },
  { slot: 4, name: 'Olympian Crown', multiplier: 5, winsRequired: 25_000_000, color: 0xffc51f, style: 'crown' },
  { slot: 5, name: 'Nova Heart', multiplier: 10, winsRequired: 2_500_000_000, color: 0xff5fe0, style: 'nova' },
  { slot: 6, name: 'Divine Ascension', multiplier: 25, winsRequired: 100_000_000_000, color: 0xffffff, style: 'divine' },
];

/** Slots must fit `PlayerState.ownedAuras`, a uint8 bitmask. */
export const MAX_AURA_SLOTS = 8;

export const NO_AURA = 0;

export const auraBySlot = (slot: number): AuraTier | undefined =>
  AURA_TIERS.find((tier) => tier.slot === slot);

export const auraMask = (slot: number): number => 1 << (Math.floor(slot) - 1);

export const isAuraOwned = (owned: number, slot: number): boolean =>
  (owned & auraMask(slot)) !== 0;

/** Multiplier from the worn aura. 1 for none, and 1 for any slot not owned. */
export const auraMultiplier = (slot: number, owned: number): number => {
  const tier = auraBySlot(slot);
  if (!tier) return 1;
  return isAuraOwned(owned, tier.slot) ? tier.multiplier : 1;
};
