import { logger } from '../util/logger.js';

const SCOPE = 'persistence';

/** Retry backoff, in milliseconds. Grows to the cap and stays there. */
const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 30_000;

interface Entry<T> {
  latest: T;
  /** True when `latest` has not been written yet. */
  dirty: boolean;
  /** Resolvers for every put not yet landed. */
  waiters: Array<() => void>;
  running: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * A LATEST-WINS write queue, one lane per key.
 *
 * A save is a snapshot of one player, and a newer snapshot makes an older one
 * pointless: so a key holds ONE pending value, and a put that arrives while
 * an older value is being written simply replaces what is written next. A
 * write that fails is retried on a growing backoff until it succeeds; nothing
 * is ever dropped, and every put's promise resolves once a write that
 * includes it (or something newer) has landed.
 */
export class WriteQueue<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly label: string,
    private readonly write: (key: string, value: T) => Promise<void>,
  ) {}

  /** Keys with a write still outstanding. */
  get outstanding(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.dirty || entry.running) count += 1;
    return count;
  }

  put(key: string, value: T): Promise<void> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { latest: value, dirty: true, waiters: [], running: false };
      this.entries.set(key, entry);
    } else {
      entry.latest = value;
      entry.dirty = true;
    }
    const landed = new Promise<void>((resolve) => entry.waiters.push(resolve));
    if (!entry.running) void this.run(key, entry);
    return landed;
  }

  /** Resolves when every lane is idle, or false at the deadline. */
  async drain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.outstanding > 0) {
      if (Date.now() >= deadline) return false;
      await sleep(50);
    }
    return true;
  }

  private async run(key: string, entry: Entry<T>): Promise<void> {
    entry.running = true;
    let delay = FIRST_RETRY_MS;
    try {
      while (entry.dirty) {
        const value = entry.latest;
        const waiters = entry.waiters;
        entry.waiters = [];
        entry.dirty = false;
        try {
          await this.write(key, value);
          for (const resolve of waiters) resolve();
          delay = FIRST_RETRY_MS;
        } catch (error) {
          // Put the waiters back at the front; they are owed this value or a
          // newer one, and the next attempt writes whichever is latest.
          entry.waiters = [...waiters, ...entry.waiters];
          entry.dirty = true;
          logger.error(SCOPE, `${this.label} write for ${key} failed, retrying in ${delay} ms:`, error);
          await sleep(delay);
          delay = Math.min(MAX_RETRY_MS, delay * 2);
        }
      }
    } finally {
      entry.running = false;
      if (!entry.dirty) this.entries.delete(key);
    }
  }
}
