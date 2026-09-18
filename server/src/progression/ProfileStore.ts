import { INITIAL_OWNED_TRAILS, INITIAL_OWNED_UPGRADES } from '@godspeed/shared';
import { createPersistence, type PersistenceAdapter, type StoredProfile } from '../persistence/index.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * Progression that outlives a session.
 *
 * A CACHE in front of a durable adapter. Keyed by a browser-stored player id
 * (or the Bloxity account id, when there is one).
 */
class ProfileStore {
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly adapter: PersistenceAdapter = createPersistence();
  private opened = false;

  open(): void {
    if (this.opened) return;
    this.opened = true;
    for (const [id, profile] of this.adapter.load()) this.profiles.set(id, profile);
  }

  get size(): number {
    return this.profiles.size;
  }

  entries(): IterableIterator<[string, StoredProfile]> {
    return this.profiles.entries();
  }

  /**
   * Apply a stored profile onto fresh player state.
   *
   * Only the DERIVING facts are restored. Level, movement speed, the equipped
   * upgrade and the Speed rate are all recomputed by their own services.
   */
  restore(playerId: string, player: PlayerState): boolean {
    const profile = this.profiles.get(playerId);
    if (!profile) return false;

    player.totalSpeed = profile.totalSpeed;
    player.wins = profile.wins;
    player.ownedUpgrades = profile.ownedUpgrades | INITIAL_OWNED_UPGRADES;
    player.rebirths = profile.rebirths;
    player.ownedTrails = profile.ownedTrails | INITIAL_OWNED_TRAILS;
    player.trailSlot = profile.trailSlot;
    player.ownedAuras = profile.ownedAuras;
    player.auraSlot = profile.auraSlot;
    player.ownedCharms = profile.ownedCharms;
    player.equippedCharms = profile.equippedCharms;
    player.bestStage = profile.bestStage;
    player.playSeconds = profile.playSeconds;
    player.displayName = profile.displayName ?? '';
    player.avatarUrl = profile.avatarUrl ?? '';
    return true;
  }

  save(playerId: string, player: PlayerState): void {
    if (!playerId) return;
    this.profiles.set(playerId, {
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
    });
    this.adapter.save(this.profiles);
  }

  flush(): void {
    this.adapter.flush();
  }
}

export const profileStore = new ProfileStore();
