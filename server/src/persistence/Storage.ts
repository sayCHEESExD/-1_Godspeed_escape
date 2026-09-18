import type { MigrationFields, ProfileFields, StoredProfile } from './StoredProfile.js';

/**
 * One paid purchase, as recorded by the webhook and drained by a room.
 *
 * Keyed by Bloxity's transaction id, which is what makes a retried webhook a
 * duplicate rather than a second payout. `claimedAt/claimedBy` is a LEASE: a
 * room claims a grant before applying it, so two pods cannot both apply one;
 * a claim that never reached `appliedAt` (the pod died in between) expires
 * and may be claimed again.
 */
export interface StoredGrant {
  readonly transactionId: string;
  /** The ACCOUNT key the purchase belongs to. Never a browser id. */
  readonly accountKey: string;
  readonly sku: string;
  readonly wins: number;
  readonly createdAt: number;
  claimedAt: number | null;
  claimedBy: string | null;
  appliedAt: number | null;
}

export type StorageKind = 'mongo' | 'json';

/**
 * WHERE PROFILES AND GRANTS LIVE. The contract is PER KEY, because several
 * pods share one database and nothing may write back a snapshot of a whole
 * map that another pod has since changed.
 *
 * Reads THROW when storage cannot be reached: a failed read is not "no
 * profile", and a caller that cannot tell the difference would let a player
 * in on an empty profile that autosaves over their real one.
 *
 * `put` never drops a write. It queues the latest snapshot per key, retries
 * on a backoff for as long as it takes, and resolves once the write has
 * landed.
 */
export interface ProfileStorage {
  readonly kind: StorageKind;

  /** Connect / load. Logs loudly on failure and DOES NOT THROW: boot must succeed. */
  open(): Promise<void>;

  /** The profile under a key, or null when there is none. THROWS on failure. */
  get(key: string): Promise<StoredProfile | null>;

  /**
   * Write a save. Resolves when durable. `extras` are set alongside; the
   * known clearable fields are unset when empty; every other stored field is
   * left as it was.
   */
  put(key: string, fields: ProfileFields, extras?: MigrationFields): Promise<void>;

  /** Create a profile only if the key is free. THROWS on failure. */
  insertIfAbsent(key: string, profile: ProfileFields & MigrationFields): Promise<boolean>;

  /** Every profile, for the leaderboards' cache. THROWS on failure. */
  loadAll(): Promise<Map<string, StoredProfile>>;

  /** Record a purchase durably. 'duplicate' when its transaction is known. THROWS on failure. */
  recordGrant(grant: StoredGrant): Promise<'recorded' | 'duplicate'>;

  /** Claim every unapplied grant of an account, atomically per grant. THROWS on failure. */
  claimGrants(accountKey: string, claimedBy: string): Promise<StoredGrant[]>;

  /** Mark grants applied, once their Wins have been saved. Queued and retried like a put. */
  settleGrants(transactionIds: readonly string[]): Promise<void>;

  /** Wait for queued writes. False if some were still outstanding at the deadline. */
  flush(timeoutMs?: number): Promise<boolean>;

  close(): Promise<void>;
}
