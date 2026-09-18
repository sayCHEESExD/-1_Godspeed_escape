/**
 * Display handles.
 *
 * A player is identified INTERNALLY by an id their browser generated or by
 * their Bloxity account id. The boards still need a stable KEY per player, so
 * a handle is DERIVED from that id - deterministically, so the same player is
 * the same row on every board, in every session, on every machine.
 *
 * A DERIVED HANDLE IS NEVER A NAME. It keys a row; `visibleName` decides what
 * is drawn.
 */

const FIRST = [
  'Swift', 'Bold', 'Wild', 'Lucky', 'Turbo', 'Iron', 'Neon', 'Storm',
  'Sunny', 'Rapid', 'Mega', 'Cosmic', 'Frost', 'Ember', 'Jade', 'Vivid',
] as const;

const SECOND = [
  'Runner', 'Titan', 'Hermes', 'Comet', 'Bolt', 'Dash', 'Strider', 'Zephyr',
  'Sprinter', 'Trail', 'Sprint', 'Seraph', 'Racer', 'Charger', 'Halo', 'Nova',
] as const;

/** A stable 32-bit FNV-1a hash of a string. */
const hash = (value: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** The handle a player id is keyed as, e.g. `@SwiftRunner_2F91`. */
export const handleFor = (playerId: string): string => {
  if (!playerId) return '@Runner_0000';
  const h = hash(playerId);
  const first = FIRST[h % FIRST.length] as string;
  const second = SECOND[(h >>> 8) % SECOND.length] as string;
  const tag = ((h >>> 16) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `@${first}${second}_${tag}`;
};

/** How many places each board shows. */
export const LEADERBOARD_SIZE = 9;
