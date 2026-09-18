/**
 * THE SPEED UPGRADES: the fifteen tiles in the spawn hub.
 *
 * Each one is PERMANENT and sets how much Speed a step is worth. They are
 * unlocked by REACHING a Wins total - a gate, not a purchase: the tile says
 * "10 Wins required", and a player who has ten Wins walks onto it and owns it
 * for ever, Wins intact. That is what the reference art's tiles say and it is
 * how the +1 games play.
 *
 * The values are EXACTLY as specified, including the deliberately unusual
 * step where +512 requires more than +1K. `verify:progression` asserts them.
 *
 * Every tier also carries its GOD POWER: the visual identity the sprint effect
 * wears while this tier is equipped. Presentation only - the client reads it,
 * the server never does - but it lives beside the tier because a tier IS a
 * power, and the two must never fall out of order.
 */

/** How the client draws a tier's sprint power. */
export type PowerStyle =
  /** A soft holy glow with rising motes. The starter. */
  | 'glow'
  /** A vertical beam of light stood in behind the runner. */
  | 'beam'
  /** Crackling electric arcs skittering around the feet. */
  | 'arc'
  /** Forked lightning striking down behind each stride. */
  | 'lightning'
  /** Rolling fire and smoke. */
  | 'flame'
  /** Straight laser streaks lancing backward. */
  | 'laser'
  /** A whole storm: lightning, wind lines and dark cloud. */
  | 'storm'
  /** Pulsing energy bursts blowing out in rings. */
  | 'burst'
  /** A halo overhead and a column of holy light. */
  | 'halo'
  /** Cosmic sparkle: stars, nebula colour, a galaxy in the wake. */
  | 'cosmic';

export interface GodPower {
  /** Main effect colour, as a hex integer. */
  readonly color: number;
  /** Secondary colour: the core of a bolt, the tip of a flame. */
  readonly accent: number;
  readonly style: PowerStyle;
  /**
   * How much of the effect to run, 1..3.
   *
   * Every unlocked tier feels more powerful than the last, and this is the
   * single knob that does it: more particles, wider trails, brighter glow.
   */
  readonly intensity: number;
}

export interface SpeedUpgrade {
  /** 1-based slot, matching the tile order in the hub. */
  readonly slot: number;
  readonly name: string;
  /** Speed granted per step while this is the equipped tier. */
  readonly speedPerStep: number;
  /** Wins the player must HOLD to unlock it. Never spent. */
  readonly winsRequired: number;
  readonly power: GodPower;
}

/**
 * The fifteen tiers, exactly as specified.
 */
export const SPEED_UPGRADES: readonly SpeedUpgrade[] = [
  { slot: 1, name: 'Divine Spark', speedPerStep: 1, winsRequired: 0,
    power: { color: 0xffe066, accent: 0xfff6c8, style: 'glow', intensity: 1 } },
  { slot: 2, name: 'Holy Beam', speedPerStep: 2, winsRequired: 1,
    power: { color: 0xfff176, accent: 0xffffff, style: 'beam', intensity: 1.1 } },
  { slot: 3, name: 'Static Arc', speedPerStep: 4, winsRequired: 10,
    power: { color: 0x7df9ff, accent: 0xe6ffff, style: 'arc', intensity: 1.2 } },
  { slot: 4, name: 'Thunderbolt', speedPerStep: 8, winsRequired: 100,
    power: { color: 0x9bd4ff, accent: 0xffffff, style: 'lightning', intensity: 1.35 } },
  { slot: 5, name: 'Solar Flare', speedPerStep: 16, winsRequired: 500,
    power: { color: 0xff9f2e, accent: 0xffe08a, style: 'flame', intensity: 1.5 } },
  { slot: 6, name: 'Sky Laser', speedPerStep: 32, winsRequired: 2_500,
    power: { color: 0x35e0ff, accent: 0xd6f9ff, style: 'laser', intensity: 1.6 } },
  { slot: 7, name: 'Storm Wrath', speedPerStep: 64, winsRequired: 50_000,
    power: { color: 0xb388ff, accent: 0xf1e6ff, style: 'storm', intensity: 1.75 } },
  { slot: 8, name: 'Nova Burst', speedPerStep: 128, winsRequired: 75_000,
    power: { color: 0xff5fe0, accent: 0xffd6f7, style: 'burst', intensity: 1.9 } },
  { slot: 9, name: 'Celestial Halo', speedPerStep: 256, winsRequired: 325_000,
    power: { color: 0xfff3c4, accent: 0xffd54a, style: 'halo', intensity: 2.0 } },
  { slot: 10, name: 'Cosmic Ray', speedPerStep: 512, winsRequired: 12_000_000,
    power: { color: 0x8b6bff, accent: 0xff9ff3, style: 'cosmic', intensity: 2.15 } },
  { slot: 11, name: 'Titan Storm', speedPerStep: 1_000, winsRequired: 10_000_000,
    power: { color: 0xff3d6a, accent: 0xffc2cf, style: 'lightning', intensity: 2.3 } },
  { slot: 12, name: 'Aurora Wave', speedPerStep: 2_000, winsRequired: 50_000_000,
    power: { color: 0x5dffb0, accent: 0xb8ffe4, style: 'beam', intensity: 2.45 } },
  { slot: 13, name: 'Eclipse', speedPerStep: 4_000, winsRequired: 250_000_000,
    power: { color: 0x6c3cff, accent: 0x1a0a3a, style: 'storm', intensity: 2.6 } },
  { slot: 14, name: "Zeus's Fury", speedPerStep: 8_000, winsRequired: 1_000_000_000,
    power: { color: 0xffc51f, accent: 0xffffff, style: 'lightning', intensity: 2.8 } },
  { slot: 15, name: 'Godspeed', speedPerStep: 16_000, winsRequired: 5_000_000_000,
    power: { color: 0xffffff, accent: 0xffe27a, style: 'cosmic', intensity: 3 } },
];

/** Slots must fit `PlayerState.ownedUpgrades`, a uint16 bitmask. */
export const MAX_UPGRADE_SLOTS = 16;

/** The tier every player starts on. Free, and owned at join. */
export const STARTER_UPGRADE_SLOT = 1;

const BY_SLOT: ReadonlyMap<number, SpeedUpgrade> = new Map(
  SPEED_UPGRADES.map((tier) => [tier.slot, tier]),
);

/**
 * The tier in a slot, or the starter when the slot is unknown.
 *
 * Never throws: a slot arriving from a save file or a stale client must
 * degrade to the starter rather than take a room down.
 */
export const upgradeForSlot = (slot: number): SpeedUpgrade => {
  const found = BY_SLOT.get(Math.floor(slot));
  if (found) return found;
  return BY_SLOT.get(STARTER_UPGRADE_SLOT) as SpeedUpgrade;
};

/** Bit for one slot in the owned mask. Slot 1 is bit 0. */
export const upgradeBit = (slot: number): number => 1 << (Math.floor(slot) - 1);

export const ownsUpgrade = (ownedMask: number, slot: number): boolean =>
  (ownedMask & upgradeBit(slot)) !== 0;

/** The owned mask a brand new profile starts with. */
export const INITIAL_OWNED_UPGRADES = upgradeBit(STARTER_UPGRADE_SLOT);

/**
 * The best tier a mask owns, by Speed per step.
 *
 * Equipping the best owned can never be a downgrade after an unlock, which is
 * why there is no separate "equip upgrade" message: unlocking is equipping.
 */
export const bestOwnedUpgrade = (ownedMask: number): SpeedUpgrade => {
  let best = upgradeForSlot(STARTER_UPGRADE_SLOT);
  for (const tier of SPEED_UPGRADES) {
    if (!ownsUpgrade(ownedMask, tier.slot)) continue;
    if (tier.speedPerStep > best.speedPerStep) best = tier;
  }
  return best;
};

/**
 * Compact display form for Speed-per-step figures: +1, +2, +1K, +16K.
 *
 * Kept next to the table it labels, so the tile in the hub and the row in a
 * panel print the same string.
 */
export const formatStep = (value: number): string => {
  const amount = Math.max(0, Math.floor(value));
  if (amount >= 1_000_000) return `${Math.round(amount / 100_000) / 10}M`;
  if (amount >= 1_000) return `${Math.round(amount / 100) / 10}K`;
  return amount.toString();
};
