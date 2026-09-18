import { INITIAL_OWNED_TRAILS, INITIAL_OWNED_UPGRADES } from '@godspeed/shared';
import {
  emptyProgress,
  progressOf,
  storage,
  type MigrationFields,
  type ProfileFields,
  type ProgressFields,
  type StoredProfile,
} from '../persistence/index.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';

const SCOPE = 'profiles';

/** How often the leaderboard cache is re-read from storage. */
const CACHE_REFRESH_MS = 30_000;

/**
 * Progression that outlives a session.
 *
 * A thin, PER-KEY front on the storage: a profile is READ FROM STORAGE AT
 * JOIN TIME, never from a cache filled at boot, because several pods share
 * one database and the boot cache of one knows nothing of what another has
 * written since. The cache here exists for exactly one reader - the
 * leaderboards, which want everyone at once - and is refreshed on a timer
 * with newer `updatedAt` winning.
 */
class ProfileStore {
  private readonly cache = new Map<string, StoredProfile>();
  private refreshTimer: NodeJS.Timeout | null = null;

  get kind(): string {
    return storage.kind;
  }

  /** Connect the store and warm the leaderboard cache. Never throws. */
  async open(): Promise<void> {
    await storage.open();
    await this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), CACHE_REFRESH_MS);
    this.refreshTimer.unref?.();
  }

  /** Profiles known to the cache, for the boards. */
  get size(): number {
    return this.cache.size;
  }

  entries(): IterableIterator<[string, StoredProfile]> {
    return this.cache.entries();
  }

  /** The profile under a key, read from storage NOW. Throws when storage is unreachable. */
  async load(key: string): Promise<StoredProfile | null> {
    const profile = await storage.get(key);
    if (profile) this.remember(key, profile);
    return profile;
  }

  /** What a live session is worth on disk: the deriving facts and the identity. */
  snapshot(player: PlayerState): ProfileFields {
    return {
      totalSpeed: player.totalSpeed,
      wins: player.wins,
      ownedUpgrades: player.ownedUpgrades,
      rebirths: player.rebirths,
      ownedTrails: player.ownedTrails,
      trailSlot: player.trailSlot,
      ownedAuras: player.ownedAuras,
      auraSlot: player.auraSlot,
      ownedCharms: player.ownedCharms,
      equippedCharms: player.equippedCharms,
      bestStage: player.bestStage,
      playSeconds: player.playSeconds,
      displayName: player.displayName,
      avatarUrl: player.avatarUrl,
      updatedAt: Date.now(),
    };
  }

  /**
   * Apply a profile onto player state - or the fresh-player defaults when
   * there is none. Only the DERIVING facts: level, movement speed, the
   * equipped upgrade and the Speed rate are recomputed by the services, which
   * the room re-runs in its join order right after this.
   */
  applyTo(player: PlayerState, profile: StoredProfile | null, keepIdentity = false): void {
    const p = profile ? progressOf(profile) : freshProgress();
    player.totalSpeed = p.totalSpeed;
    player.wins = p.wins;
    player.ownedUpgrades = p.ownedUpgrades | INITIAL_OWNED_UPGRADES;
    player.rebirths = p.rebirths;
    player.ownedTrails = p.ownedTrails | INITIAL_OWNED_TRAILS;
    player.trailSlot = p.trailSlot;
    player.ownedAuras = p.ownedAuras;
    player.auraSlot = p.auraSlot;
    player.ownedCharms = p.ownedCharms;
    player.equippedCharms = p.equippedCharms;
    player.bestStage = p.bestStage;
    player.playSeconds = p.playSeconds;
    if (!keepIdentity) {
      player.displayName = profile?.displayName ?? '';
      player.avatarUrl = profile?.avatarUrl ?? '';
    }
  }

  /** Save a live session under a key. Resolves once the write has landed. */
  async save(key: string, player: PlayerState, extras?: MigrationFields): Promise<void> {
    const fields = this.snapshot(player);
    this.remember(key, { ...(this.cache.get(key) ?? {}), ...fields, ...extras } as StoredProfile);
    await storage.put(key, fields, extras);
  }

  /** Create a profile only if the key is free. Throws when storage is unreachable. */
  async insertIfAbsent(key: string, profile: ProfileFields & MigrationFields): Promise<boolean> {
    const inserted = await storage.insertIfAbsent(key, profile);
    if (inserted) this.remember(key, { ...profile });
    return inserted;
  }

  /**
   * RETIRE a guest profile whose progress just became an account's: reset its
   * progress, keep what it held as `migratedSnapshot`, and mark where it went.
   * A retired guest is never migrated again and never ranks on a board.
   */
  async retireGuest(
    guestKey: string,
    accountKey: string,
    snapshot: ProgressFields,
    identity: { displayName: string; avatarUrl: string },
  ): Promise<void> {
    const now = Date.now();
    const fields: ProfileFields = { ...freshProgress(), ...identity, updatedAt: now };
    const extras: MigrationFields = { migratedTo: accountKey, migratedAt: now, migratedSnapshot: snapshot };
    this.remember(guestKey, { ...(this.cache.get(guestKey) ?? {}), ...fields, ...extras } as StoredProfile);
    await storage.put(guestKey, fields, extras);
  }

  flush(timeoutMs?: number): Promise<boolean> {
    return storage.flush(timeoutMs);
  }

  async close(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    await storage.close();
  }

  private remember(key: string, profile: StoredProfile): void {
    const known = this.cache.get(key);
    if (known && known.updatedAt > profile.updatedAt) return;
    this.cache.set(key, profile);
  }

  private async refresh(): Promise<void> {
    try {
      for (const [key, profile] of await storage.loadAll()) this.remember(key, profile);
    } catch (error) {
      logger.warn(SCOPE, `leaderboard cache not refreshed: ${String(error)}`);
    }
  }
}

/** What a brand-new player holds: the free starter tiers, the free trail worn. */
const freshProgress = (): ProgressFields => ({
  ...emptyProgress(),
  ownedUpgrades: INITIAL_OWNED_UPGRADES,
  ownedTrails: INITIAL_OWNED_TRAILS,
  trailSlot: 1,
});

export const profileStore = new ProfileStore();
