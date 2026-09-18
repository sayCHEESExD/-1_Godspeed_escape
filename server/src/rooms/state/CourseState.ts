import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { LEADERBOARD_SIZE } from '@godspeed/shared';
import { PlayerState } from './PlayerState.js';

/** One row of one board: who, and how much. */
export class LeaderEntry extends Schema {
  /** The row's KEY, derived from the account id. NEVER DRAWN. */
  @type('string') handle = '';
  /** THE NAME THE BOARD SHOWS: the portal's display name, or empty. */
  @type('string') name = '';
  @type('string') avatarUrl = '';
  @type('float64') value = 0;
}

/**
 * The three boards behind the upgrade terraces: Top Wins, Top Rebirths and
 * Top Time. FIXED-LENGTH arrays, allocated once and written in place.
 */
export class LeaderboardState extends Schema {
  @type([LeaderEntry]) wins = rows();
  @type([LeaderEntry]) rebirths = rows();
  @type([LeaderEntry]) time = rows();
}

const rows = (): ArraySchema<LeaderEntry> => {
  const list = new ArraySchema<LeaderEntry>();
  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) list.push(new LeaderEntry());
  return list;
};

/**
 * THE CHARM SHOP'S SHELF, as every client sees it.
 *
 * The shelf is one string of catalogue slots ("6,1,4") rather than a nested
 * array, because a schema array does not bubble its changes to a parent
 * listener and one string does. `restockIn` counts down in whole seconds so
 * the panel can show a timer without every client guessing at the server's
 * wall clock.
 */
export class ShopState extends Schema {
  @type('string') shelf = '';
  @type('uint16') restockIn = 0;
}

/** Root replicated state for a single world instance. */
export class CourseState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  /**
   * Server uptime in seconds: the CLOCK the sweeping bolts, the fading clouds
   * and the falling stones are pure functions of.
   */
  @type('float64') elapsed = 0;

  @type(LeaderboardState) leaderboard = new LeaderboardState();

  @type(ShopState) shop = new ShopState();
}
