import { LEADERBOARD_SIZE, handleFor } from '@godspeed/shared';
import type { LeaderEntry, LeaderboardState } from '../rooms/state/CourseState.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { profileStore } from './ProfileStore.js';

/** Seconds between rebuilds. A board is not a thing that needs 20 Hz. */
const REFRESH_SECONDS = 2;

interface Candidate {
  readonly handle: string;
  readonly name: string;
  readonly avatarUrl: string;
  readonly wins: number;
  readonly rebirths: number;
  readonly time: number;
}

/**
 * The three boards behind the upgrade terraces: Top Wins, Top Rebirths and
 * Top Time (seconds played).
 *
 * Every figure is the SERVER's, merged from stored profiles and live state,
 * the live figure winning wherever both exist. Rebuilt on a timer, not per
 * tick.
 */
export class LeaderboardService {
  private timer = 0;

  update(
    delta: number,
    board: LeaderboardState,
    live: Iterable<[string, PlayerState]>,
    playerIds: ReadonlyMap<string, string>,
  ): boolean {
    this.timer -= delta;
    if (this.timer > 0) return false;
    this.timer = REFRESH_SECONDS;
    this.rebuild(board, live, playerIds);
    return true;
  }

  rebuild(
    board: LeaderboardState,
    live: Iterable<[string, PlayerState]>,
    playerIds: ReadonlyMap<string, string>,
  ): void {
    const byHandle = new Map<string, Candidate>();

    for (const [id, profile] of profileStore.entries()) {
      const handle = handleFor(id);
      byHandle.set(handle, {
        handle,
        name: profile.displayName ?? '',
        avatarUrl: profile.avatarUrl ?? '',
        wins: profile.wins,
        rebirths: profile.rebirths,
        time: profile.playSeconds ?? 0,
      });
    }

    for (const [sessionId, player] of live) {
      const id = playerIds.get(sessionId);
      if (!id) continue;
      const handle = handleFor(id);
      byHandle.set(handle, {
        handle,
        name: player.displayName,
        avatarUrl: player.avatarUrl,
        wins: player.wins,
        rebirths: player.rebirths,
        time: player.playSeconds,
      });
    }

    const all = [...byHandle.values()];
    fill(board.wins, all, (c) => c.wins);
    fill(board.rebirths, all, (c) => c.rebirths);
    fill(board.time, all, (c) => c.time);
  }
}

/** Rank by one field and write the top N into a replicated array, in place. */
const fill = (
  into: LeaderEntry[] & { push(entry: LeaderEntry): unknown },
  all: readonly Candidate[],
  pick: (candidate: Candidate) => number,
): void => {
  const ranked = all
    .filter((candidate) => pick(candidate) > 0)
    .sort((a, b) => pick(b) - pick(a))
    .slice(0, LEADERBOARD_SIZE);

  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) {
    const entry = into[i];
    if (!entry) continue;
    const candidate = ranked[i];
    const handle = candidate ? candidate.handle : '';
    const name = candidate ? candidate.name : '';
    const avatarUrl = candidate ? candidate.avatarUrl : '';
    const value = candidate ? Math.floor(pick(candidate)) : 0;
    if (entry.handle !== handle) entry.handle = handle;
    if (entry.name !== name) entry.name = name;
    if (entry.avatarUrl !== avatarUrl) entry.avatarUrl = avatarUrl;
    if (entry.value !== value) entry.value = value;
  }
};

export const leaderboardService = new LeaderboardService();
