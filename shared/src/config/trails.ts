/**
 * Trails: the FLAT Speed bonus ladder, in the Backpack.
 *
 * A trail ADDS a fixed figure to the Speed each step is worth - "+4 speed" on
 * the row, and exactly four more per step - and it goes through the one shared
 * rate formula (`speedPerStepFor`) rather than a calculation of its own.
 *
 * Unlocked by REACHING a Wins total, like the speed upgrades: the row says
 * what it requires, and a player who holds that many Wins unlocks it with a
 * tap and keeps the Wins. Ownership and the worn slot are server state.
 *
 * Nineteen tiers, exactly as specified, and every one wears a divine look.
 */

/** How the client draws a trail. Presentation only; never gameplay. */
export type TrailStyle =
  | 'solid'
  | 'holy'
  | 'lightning'
  | 'fire'
  | 'energy'
  | 'cosmic'
  | 'rainbow'
  | 'void';

export interface TrailTier {
  /** 1-based slot, matching the backpack rows top to bottom. */
  readonly slot: number;
  readonly name: string;
  /** Speed ADDED per step while worn. */
  readonly bonus: number;
  /** Wins the player must HOLD to unlock it. Never spent. */
  readonly winsRequired: number;
  /** Base colour, as a hex integer. */
  readonly color: number;
  readonly style: TrailStyle;
}

export const TRAIL_TIERS: readonly TrailTier[] = [
  { slot: 1, name: 'Ember Trail', bonus: 1, winsRequired: 0, color: 0xffb347, style: 'solid' },
  { slot: 2, name: 'Sky Trail', bonus: 2, winsRequired: 3, color: 0x7fd4ff, style: 'solid' },
  { slot: 3, name: 'Blossom Trail', bonus: 4, winsRequired: 10, color: 0xff8ad8, style: 'holy' },
  { slot: 4, name: 'Frost Trail', bonus: 8, winsRequired: 100, color: 0xa8ecff, style: 'energy' },
  { slot: 5, name: 'Spark Trail', bonus: 16, winsRequired: 500, color: 0xfff176, style: 'lightning' },
  { slot: 6, name: 'Inferno Trail', bonus: 32, winsRequired: 2_500, color: 0xff6a1e, style: 'fire' },
  { slot: 7, name: 'Storm Trail', bonus: 64, winsRequired: 15_000, color: 0x9bd4ff, style: 'lightning' },
  { slot: 8, name: 'Halo Trail', bonus: 128, winsRequired: 75_000, color: 0xffe9a8, style: 'holy' },
  { slot: 9, name: 'Nebula Trail', bonus: 256, winsRequired: 375_000, color: 0xb388ff, style: 'cosmic' },
  { slot: 10, name: 'Plasma Trail', bonus: 512, winsRequired: 2_000_000, color: 0x35e0ff, style: 'energy' },
  { slot: 11, name: 'Phoenix Trail', bonus: 1_000, winsRequired: 10_000_000, color: 0xff3d3d, style: 'fire' },
  { slot: 12, name: 'Thunder Trail', bonus: 2_000, winsRequired: 50_000_000, color: 0xd9c4ff, style: 'lightning' },
  { slot: 13, name: 'Seraph Trail', bonus: 4_000, winsRequired: 250_000_000, color: 0xffffff, style: 'holy' },
  { slot: 14, name: 'Galaxy Trail', bonus: 8_000, winsRequired: 1_000_000_000, color: 0x8b6bff, style: 'cosmic' },
  { slot: 15, name: 'Eclipse Trail', bonus: 16_000, winsRequired: 5_000_000_000, color: 0x3a1a6e, style: 'void' },
  { slot: 16, name: 'Titan Trail', bonus: 32_000, winsRequired: 10_000_000_000, color: 0xff9f2e, style: 'fire' },
  { slot: 17, name: 'Olympus Trail', bonus: 64_000, winsRequired: 55_000_000_000, color: 0xffd54a, style: 'holy' },
  { slot: 18, name: 'Prism Trail', bonus: 128_000, winsRequired: 500_000_000_000, color: 0xff5fe0, style: 'rainbow' },
  { slot: 19, name: 'Godspeed Trail', bonus: 256_000, winsRequired: 4_000_000_000_000, color: 0xffffff, style: 'cosmic' },
];

/** Slots must fit `PlayerState.ownedTrails`, a uint32 bitmask. */
export const MAX_TRAIL_SLOTS = 31;

/** Nothing equipped. */
export const NO_TRAIL = 0;

export const trailBySlot = (slot: number): TrailTier | undefined =>
  TRAIL_TIERS.find((tier) => tier.slot === slot);

/** One bit per slot, so the whole inventory is a single replicated integer. */
export const trailMask = (slot: number): number => 1 << (Math.floor(slot) - 1);

export const isTrailOwned = (owned: number, slot: number): boolean =>
  (owned & trailMask(slot)) !== 0;

/** The owned mask a new profile starts with: the free trail. */
export const INITIAL_OWNED_TRAILS = trailMask(1);

/**
 * Flat Speed bonus from the worn trail.
 *
 * Returns 0 for "none worn" and for any slot that is not owned, so an unowned
 * or forged slot can only ever mean "no bonus".
 */
export const trailBonus = (slot: number, owned: number): number => {
  const tier = trailBySlot(slot);
  if (!tier) return 0;
  return isTrailOwned(owned, tier.slot) ? tier.bonus : 0;
};
