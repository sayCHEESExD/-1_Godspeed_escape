import { INITIAL_OWNED_TRAILS, INITIAL_OWNED_UPGRADES } from '@godspeed/shared';

/**
 * The DERIVING facts of a player's progression: everything a session is
 * rebuilt from. Level, movement speed, the equipped upgrade and the Speed
 * rate are recomputed from these by the same formulas a live session uses.
 */
export interface ProgressFields {
  /** Lifetime Speed farmed. Level follows from it. */
  totalSpeed: number;
  /** Stage wins held. */
  wins: number;
  /** Bitmask of speed upgrades unlocked. The equipped one is the best of these. */
  ownedUpgrades: number;
  rebirths: number;
  ownedTrails: number;
  trailSlot: number;
  ownedAuras: number;
  auraSlot: number;
  ownedCharms: number;
  equippedCharms: number;
  /** Highest stage ever finished. */
  bestStage: number;
  /** Seconds played, lifetime. */
  playSeconds: number;
}

/** What one save writes. */
export interface ProfileFields extends ProgressFields {
  /** The portal's display name and portrait as last seen. Cleared when empty. */
  displayName: string;
  avatarUrl: string;
  /** Wall clock of the save. */
  updatedAt: number;
}

/**
 * The first-login migration's bookkeeping.
 *
 *   - An ACCOUNT profile created from a browser's guest progress carries
 *     `migratedFrom`, the guest key it came from.
 *   - That GUEST profile is then RETIRED: its progress is reset, it carries
 *     `migratedTo` (the account key), `migratedAt`, and `migratedSnapshot` -
 *     the progress it held at that moment, kept as a recovery copy. A retired
 *     guest is never migrated again and never appears on a leaderboard.
 */
export interface MigrationFields {
  migratedFrom?: string;
  migratedTo?: string;
  migratedAt?: number;
  migratedSnapshot?: ProgressFields;
}

/**
 * A profile as READ from storage. Beyond the fields this build knows, it may
 * carry any field a newer or older build wrote: those are kept and written
 * back untouched, never dropped.
 */
export type StoredProfile = ProfileFields & MigrationFields & { [field: string]: unknown };

export const PROGRESS_KEYS = [
  'totalSpeed',
  'wins',
  'ownedUpgrades',
  'rebirths',
  'ownedTrails',
  'trailSlot',
  'ownedAuras',
  'auraSlot',
  'ownedCharms',
  'equippedCharms',
  'bestStage',
  'playSeconds',
] as const satisfies readonly (keyof ProgressFields)[];

/** Optional string fields a save may CLEAR. The only fields ever $unset. */
export const CLEARABLE_FIELDS = ['displayName', 'avatarUrl'] as const;

const numeric = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const emptyProgress = (): ProgressFields => ({
  totalSpeed: 0,
  wins: 0,
  ownedUpgrades: 0,
  rebirths: 0,
  ownedTrails: 0,
  trailSlot: 0,
  ownedAuras: 0,
  auraSlot: 0,
  ownedCharms: 0,
  equippedCharms: 0,
  bestStage: 0,
  playSeconds: 0,
});

/** Just the progression of a profile, coerced. */
export const progressOf = (source: Partial<ProgressFields>): ProgressFields => {
  const out = emptyProgress();
  for (const key of PROGRESS_KEYS) out[key] = numeric(source[key]);
  return out;
};

/**
 * Coerce whatever storage held into a profile, KEEPING every unknown field.
 *
 * The known numbers are made numbers, the known strings strings, the
 * migration fields kept only in the shapes they are written in - and
 * everything else rides along as it was.
 */
export const coerceProfile = (raw: unknown): StoredProfile | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const profile: StoredProfile = {
    ...source,
    ...progressOf(source as Partial<ProgressFields>),
    displayName: text(source['displayName']),
    avatarUrl: text(source['avatarUrl']),
    updatedAt: numeric(source['updatedAt']),
  };
  if (typeof source['migratedFrom'] !== 'string') delete profile.migratedFrom;
  if (typeof source['migratedTo'] !== 'string') delete profile.migratedTo;
  if (typeof source['migratedAt'] !== 'number') delete profile.migratedAt;
  if (source['migratedSnapshot'] && typeof source['migratedSnapshot'] === 'object') {
    profile.migratedSnapshot = progressOf(source['migratedSnapshot'] as Partial<ProgressFields>);
  } else {
    delete profile.migratedSnapshot;
  }
  return profile;
};

/**
 * Whether a profile holds anything worth carrying into an account.
 *
 * The starter tiers every profile is born with do not count, and neither does
 * time played on its own: a guest who opened the game and stood still has
 * nothing to migrate, and migrating nothing would still retire their guest
 * key for ever.
 */
export const hasProgress = (p: ProgressFields): boolean =>
  p.totalSpeed > 0 ||
  p.wins > 0 ||
  p.bestStage > 0 ||
  p.rebirths > 0 ||
  (p.ownedUpgrades & ~INITIAL_OWNED_UPGRADES) !== 0 ||
  (p.ownedTrails & ~INITIAL_OWNED_TRAILS) !== 0 ||
  p.ownedAuras !== 0 ||
  p.ownedCharms !== 0;
