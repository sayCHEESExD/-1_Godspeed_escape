/**
 * Everything worth keeping about a player between sessions.
 *
 * Deliberately the DERIVING facts only: level, movement speed, the equipped
 * upgrade and the Speed rate are all recomputed from these on load through
 * the same formulas a live session uses, so a tuning change reaches returning
 * players too.
 */
export interface StoredProfile {
  /** Lifetime Speed farmed. Level follows from it. */
  totalSpeed: number;
  /** Stage wins held. */
  wins: number;
  /** Bitmask of speed upgrades unlocked. The equipped one is the best of these. */
  ownedUpgrades: number;
  /** Rebirths performed. */
  rebirths: number;
  /** Bitmask of trails unlocked, and the one worn. */
  ownedTrails: number;
  trailSlot: number;
  /** Bitmask of auras unlocked, and the one worn. */
  ownedAuras: number;
  auraSlot: number;
  /** Bitmask of charms bought, and the ones worn. */
  ownedCharms: number;
  equippedCharms: number;
  /** Highest stage ever finished. */
  bestStage: number;
  /** Seconds played, lifetime. */
  playSeconds: number;
  /** The portal's display name and portrait as last seen. Optional. */
  displayName?: string;
  avatarUrl?: string;
  /** Wall clock of the last save. */
  updatedAt: number;
}

/**
 * Where profiles live. `createPersistence` is the ONLY place that names a
 * concrete adapter.
 */
export interface PersistenceAdapter {
  load(): Map<string, StoredProfile>;
  save(profiles: Map<string, StoredProfile>): void;
  flush(): void;
}
