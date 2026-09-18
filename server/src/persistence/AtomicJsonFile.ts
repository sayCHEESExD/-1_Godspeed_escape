import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '../util/logger.js';

const SCOPE = 'persistence';

/** Milliseconds a write waits for more changes before hitting the disk. */
const DEBOUNCE_MS = 40;
const FIRST_RETRY_MS = 250;
const MAX_RETRY_MS = 10_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * One JSON document on disk, written ATOMICALLY: to a temp file, fsynced,
 * then renamed over the real one. A crash mid-write leaves either the old
 * file or the new one, never a torn save.
 *
 * `load()` is what makes that promise hold across the crash:
 *
 *   - a leftover `.tmp` beside a MISSING file is a write that got as far as
 *     the fsync and not the rename, so it is completed by renaming it in;
 *   - a leftover `.tmp` beside a GOOD file is a write that never finished,
 *     and is discarded;
 *   - a file that cannot be parsed is MOVED ASIDE with its bytes intact, so
 *     whatever it held can be recovered by hand, and the store starts empty
 *     rather than overwriting it on the next save.
 *
 * Writes are asynchronous and serialised: the routine `fsync` is the slowest
 * call here by orders of magnitude and must not block the simulation, so it
 * is awaited; overlapping writes coalesce into the latest document. A write
 * that fails is retried until it lands. `flushSync()` exists for the exit
 * path, where there is no event loop left to await on.
 */
export class AtomicJsonFile<T> {
  private readonly tempPath: string;
  private pending: T | null = null;
  private waiters: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private writing = false;

  constructor(private readonly path: string) {
    this.tempPath = `${path}.tmp`;
  }

  get location(): string {
    return this.path;
  }

  /** Read the document, recovering or quarantining as described above. */
  load(): T | null {
    if (!existsSync(this.path) && existsSync(this.tempPath)) {
      try {
        JSON.parse(readFileSync(this.tempPath, 'utf8'));
        renameSync(this.tempPath, this.path);
        logger.warn(SCOPE, `recovered ${this.path} from a leftover temp file`);
      } catch {
        this.discardTemp();
      }
    } else if (existsSync(this.tempPath)) {
      this.discardTemp();
    }

    if (!existsSync(this.path)) return null;
    const raw = readFileSync(this.path, 'utf8');
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      const aside = `${this.path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        renameSync(this.path, aside);
        logger.error(SCOPE, `${this.path} could not be parsed and was MOVED ASIDE to ${aside}:`, error);
      } catch (moveError) {
        logger.error(SCOPE, `${this.path} could not be parsed OR moved aside; refusing to overwrite it:`, moveError);
        throw moveError;
      }
      return null;
    }
  }

  /** Queue a write of this document. Resolves once it (or a newer one) is on disk. */
  write(document: T): Promise<void> {
    this.pending = document;
    const landed = new Promise<void>((resolve) => this.waiters.push(resolve));
    if (!this.timer && !this.writing) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.writeLoop();
      }, DEBOUNCE_MS);
      this.timer.unref?.();
    }
    return landed;
  }

  get hasPending(): boolean {
    return this.pending !== null || this.writing;
  }

  /** Wait for the queue to empty, or false at the deadline. */
  async drain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.hasPending) {
      if (Date.now() >= deadline) return false;
      await sleep(20);
    }
    return true;
  }

  /** The blocking write of whatever is pending. Shutdown and exit only. */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const document = this.pending;
    if (document === null) return;
    this.pending = null;
    const waiters = this.waiters;
    this.waiters = [];
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const handle = openSync(this.tempPath, 'w');
      try {
        writeSync(handle, JSON.stringify(document));
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(this.tempPath, this.path);
      for (const resolve of waiters) resolve();
    } catch (error) {
      logger.error(SCOPE, `failed to flush ${this.path}:`, error);
      this.pending = document;
      this.waiters = waiters;
    }
  }

  private async writeLoop(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    let delay = FIRST_RETRY_MS;
    try {
      while (this.pending !== null) {
        const document = this.pending;
        const waiters = this.waiters;
        this.pending = null;
        this.waiters = [];
        try {
          await mkdir(dirname(this.path), { recursive: true });
          const handle = await open(this.tempPath, 'w');
          try {
            await handle.writeFile(JSON.stringify(document));
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(this.tempPath, this.path);
          for (const resolve of waiters) resolve();
          delay = FIRST_RETRY_MS;
        } catch (error) {
          logger.error(SCOPE, `failed to write ${this.path}, retrying in ${delay} ms:`, error);
          // Nothing newer arrived meanwhile? Then this document is still the
          // one owed. Either way every waiter is still owed a landing.
          if (this.pending === null) this.pending = document;
          this.waiters = [...waiters, ...this.waiters];
          await sleep(delay);
          delay = Math.min(MAX_RETRY_MS, delay * 2);
        }
      }
    } finally {
      this.writing = false;
    }
  }

  private discardTemp(): void {
    try {
      unlinkSync(this.tempPath);
      logger.warn(SCOPE, `discarded an unfinished temp file beside ${this.path}`);
    } catch {
      /* nothing to discard */
    }
  }
}
