import { accountKeyFor } from '@godspeed/shared';
import { serverConfig } from '../config/serverConfig.js';
import { storage, type StoredGrant } from '../persistence/index.js';
import { logger } from '../util/logger.js';

const SCOPE = 'bux';

/**
 * What a SKU is worth, in Wins.
 *
 * The PRICE is not here and must never be: Bloxity charges the Bux from its
 * own catalogue, keyed by the game slug, and this server is only ever told
 * which SKU was bought. What this table decides is the other half - what the
 * game hands over - and that half belongs to the game.
 *
 * An unknown SKU grants nothing and is logged. The webhook still answers 2xx:
 * refusing it would have Bloxity refund a purchase that was genuinely made,
 * and a SKU this build has not heard of is far more likely to be a catalogue
 * that moved ahead of a deploy than an attack.
 */
const SKU_WINS: Readonly<Record<string, number>> = {
  wins_small: 250,
  wins_large: 1500,
};

/** SKUs that grant something other than Wins, so they are not "unknown". */
const KNOWN_NON_WINS = new Set(['speed_boost_1h']);

/** One purchase, claimed by a room and about to be paid out. */
export interface PendingGrant {
  readonly transactionId: string;
  readonly sku: string;
  readonly wins: number;
}

/**
 * Purchases that have been paid for and not yet handed over.
 *
 * DURABLE, and shared by every pod: the webhook arrives on whichever pod
 * Bloxity reached, at a moment of its choosing, while the player may be live
 * in a room on another pod with their Wins in replicated state that the
 * autosave will write over the stored profile a few seconds later. So the
 * webhook only ever RECORDS - into the database, keyed by the transaction id
 * so a retry is a duplicate rather than a second payout - and the room that
 * holds the player CLAIMS what is waiting, on join and on a slow poll, pays
 * it out, saves, and only then marks it applied.
 *
 * Grants belong to the VERIFIED ACCOUNT KEY. The webhook's user id is
 * Bloxity's, server to server; nothing a browser says ever reaches here.
 */
class BuxGrants {
  /** Record a paid purchase durably. Throws when storage is unreachable. */
  async record(accountId: string, transactionId: string, sku: string): Promise<'recorded' | 'duplicate'> {
    const wins = SKU_WINS[sku] ?? 0;
    if (wins === 0 && !KNOWN_NON_WINS.has(sku)) {
      logger.warn(SCOPE, `unknown sku "${sku}" - nothing to grant`);
    }
    const grant: StoredGrant = {
      transactionId,
      accountKey: accountKeyFor(accountId),
      sku,
      wins,
      createdAt: Date.now(),
      claimedAt: null,
      claimedBy: null,
      appliedAt: null,
    };
    const outcome = await storage.recordGrant(grant);
    if (outcome === 'duplicate') logger.info(SCOPE, `duplicate webhook for ${transactionId}, ignored`);
    else logger.info(SCOPE, `recorded ${sku} (+${wins} wins) for ${grant.accountKey} [${transactionId}]`);
    return outcome;
  }

  /** Claim everything waiting for an account, atomically per grant. Throws when storage is unreachable. */
  async claim(accountKey: string): Promise<PendingGrant[]> {
    const claimed = await storage.claimGrants(accountKey, serverConfig.podName);
    return claimed.map((grant) => ({ transactionId: grant.transactionId, sku: grant.sku, wins: grant.wins }));
  }

  /** Mark grants paid out, once the Wins they granted have been saved. */
  settle(transactionIds: readonly string[]): Promise<void> {
    return storage.settleGrants(transactionIds);
  }
}

export const buxGrants = new BuxGrants();
