import type { Aabb } from '../types/math.js';
import { MOVEMENT, resolveMovementProfile } from './movement.js';
import { SPRINT } from './sprint.js';
import { SPEED_UPGRADES, type SpeedUpgrade } from './upgrades.js';
import { totalSpeedToReach } from './speed.js';

/**
 * The world, as pure data.
 *
 * Everything the player can stand on, bump into or be killed by is defined
 * here, and both the renderer and the authoritative server read the same
 * arrays. There are no world coordinates anywhere else - a platform the client
 * draws but the server does not know about is the one bug this file exists to
 * make impossible.
 *
 * The world is LINEAR along +Z and it CLIMBS: a marble spawn hub floating in
 * the sky, then twelve stages of Olympus rising toward the throne. Each stage
 * begins at the height the one before it reached, so the run is a vertical
 * ascent as well as a course - and every gap and climb is authored against
 * the arc one jump produces at a run, so nothing here needs the sprint. The
 * sprint makes it FAST; it never makes it possible.
 */

/** What a solid is for. Presentation reads this; the simulation does not. */
export type SolidKind =
  /** Marble paving with a gold inlay: the course floor. */
  | 'floor'
  /** The hub's own paving: the same marble, warmer, with the gold star. */
  | 'lobby'
  /** The raised decks of the treadmill bay and the upgrade rows. */
  | 'deck'
  /** A gold-trimmed marble block to hop onto or over. */
  | 'block'
  /** A narrow marble bridge. */
  | 'bridge'
  /** A fluted marble column to weave around. */
  | 'pillar'
  /** The gold win pad at the player's LEFT at a stage's end. */
  | 'winPad'
  /** The RETURN pad at the player's RIGHT. Pays nothing. */
  /** A speed upgrade tile in the hub. */
  | 'tile'
  /** A cloud platform that periodically fades. */
  | 'sinking'
  /** Polished marble. Slippery, via the surface region on it. */
  | 'ice'
  /** A solid cloud: soft, white, walkable. */
  | 'cloud'
  /** A floating marble island: the course's primary platform. */
  | 'island'
  /** A LAUNCH PAD: a disc of divine light that throws the player up. */
  | 'launch'
  /** A step of the hub stairs. */
  | 'stair'
  /** A wall: marble balustrade or a golden gate jamb. */
  | 'wall';

/** One axis-aligned solid. */
export interface CourseSolid extends Aabb {
  readonly kind: SolidKind;
  /** Stage this belongs to; -1 for the hub. */
  readonly stage: number;
}

/**
 * A solid that rises and sinks as a pure function of TIME.
 *
 * Both sides evaluate `sinkingOffsetAt`, so a platform is in the same place on
 * every machine with nothing replicated and nothing to forge. The cycle is
 * four-part - up, warning, sunk, rising - so a platform that fades is a
 * decision rather than a coin flip. A tall one authored across a corridor is
 * a SHUTTER: a golden gate that drops and rises.
 */
export interface SinkingSolid extends CourseSolid {
  readonly cycle: number;
  readonly phase: number;
  readonly steady: number;
  readonly warn: number;
  readonly sunk: number;
  readonly depth: number;
}

/**
 * The cloud sea under a stretch of platforms: the thing that kills.
 *
 * `surfaceY` is where the clouds are drawn and `deathY` is barely below it,
 * so falling in reads as being swallowed by the clouds rather than as a long
 * drop into nothing.
 */
export interface HazardPool {
  readonly stage: number;
  readonly surface: 'cloud' | 'storm' | 'void';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly surfaceY: number;
  readonly deathY: number;
}

export type QuicksandRegion = HazardPool;

/** How a hazard moves. */
export type HazardKind =
  /** A lightning bolt sweeping side to side across the corridor. */
  | 'sweeper'
  /** A thunder orb rolling down the corridor toward the player. */
  | 'roller'
  /** A beam of light orbiting a hub. Several at stepped radii make a bar. */
  | 'spinner'
  /** A thunder stone that falls from above onto a fixed spot and rises again. */
  | 'faller'
  /** An energy vortex, orbiting like a spinner. */
  | 'tornado'
  /** A static bed of golden spears. */
  | 'spike';

/**
 * A killer. Position is a pure function of TIME, so the server evaluates it
 * from its own clock and the client from the replicated one.
 */
export interface CourseHazard {
  readonly kind: HazardKind;
  readonly stage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  /** Sweeper: half-amplitude in X. Spinner: orbit radius. Faller: hover height. */
  readonly sweep: number;
  /** Sweeper/spinner: rad/s. Roller: u/s. Faller: cycle seconds. */
  readonly rate: number;
  readonly phase: number;
  readonly fromZ: number;
  readonly toZ: number;
}

/** Scenery the client draws and the simulation ignores. */
export type DecorationKind =
  /** A fluted marble column with a gold capital. */
  | 'column'
  /** A bank of cloud. */
  | 'cloud'
  /** A golden brazier with a divine flame. */
  | 'brazier'
  /** A marble arch. */
  | 'arch'
  /** A gold statue on a plinth. */
  | 'statue'
  /** A floating divine gem, slowly turning. */
  | 'gem'
  /** An olive tree. */
  | 'tree'
  /** A hanging banner. */
  | 'banner';

export interface Decoration {
  readonly kind: DecorationKind;
  readonly stage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
}

/**
 * A patch of ground that changes how the player HANDLES on it.
 *
 * Polished marble lowers `grip`, a wind gallery adds a constant push, and a
 * launch pad throws the player into the air. All three are read by
 * `stepPlayer` itself, so the client's prediction and the server's simulation
 * cannot handle differently.
 */
export interface SurfaceRegion {
  readonly stage: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly grip: number;
  readonly windX: number;
  readonly windZ: number;
  /** LAUNCH PAD: upward velocity handed to a player standing on it, or 0. */
  readonly boost: number;
}

/** A stretch of world that is WIDER than the running corridor. */
export interface WideArea {
  readonly minZ: number;
  readonly maxZ: number;
  readonly halfWidth: number;
}

/** One stage. */
export interface StageDefinition {
  readonly index: number;
  readonly name: string;
  readonly difficulty: string;
  /** Advisory only - shown on the sign, never enforced. */
  readonly recommendedLevel: number;
  /** Lifetime Speed the recommended level corresponds to. Derived. */
  readonly recommendedSpeed: number;
  readonly startZ: number;
  readonly endZ: number;
  /** Height of the stage's start and its finish apron. */
  readonly startY: number;
  readonly endY: number;
  readonly winPadX: number;
  readonly winPadZ: number;
  /** Top of the pads, so a claim can test the player is standing ON them. */
  readonly padY: number;
  /** Wins awarded for reaching it. */
  readonly winReward: number;
}

/** Global world metrics. */
export const COURSE = {
  /** Half-width of the running corridor. Every lateral offset is a fraction of it. */
  halfWidth: 24,
  /** Top of the hub floor. Everything is measured from here. */
  floorY: 0,
  /** Thickness of a floor slab, so a slab has an underside. */
  floorThickness: 4,
  /** Height of the marble balustrade along the course. Visual; the X clamp holds. */
  wallHeight: 3.2,

  /** Hub footprint. Wide, because it holds three rows of tiles and a treadmill bay. */
  lobbyHalfWidth: 86,
  lobbyStartZ: -150,
  lobbyEndZ: 0,

  /** Bridge from one stage's end to the next stage's run-up. */
  stageGap: 24,
  stageCount: 12,
} as const;

/** How far below a stage's base the cloud sea lies. */
const POOL_DROP = 10;

interface StageTuning {
  readonly name: string;
  readonly difficulty: string;
  readonly recommendedLevel: number;
}

/** What a player can do on ONE JUMP. */
interface Ballistic {
  readonly reach: number;
  readonly rise: number;
}

/**
 * The ballistic figures for a given profile.
 *
 * Exported so `verify-course` checks every gap against the same function that
 * authored it, rather than against a copy of the formula that is free to drift.
 */
export const ballisticFor = (runSpeed: number, jumpVelocity: number): Ballistic => ({
  reach: runSpeed * ((2 * jumpVelocity) / MOVEMENT.gravity),
  rise: (jumpVelocity * jumpVelocity) / (2 * MOVEMENT.gravity),
});

/** The base profile: level 1, no rebirths, at a RUN. No sprint is assumed. */
const BASE_PROFILE = resolveMovementProfile(1, 0);
const BASE_BALLISTIC: Ballistic = ballisticFor(BASE_PROFILE.moveSpeed, BASE_PROFILE.jumpVelocity);
/** The same leap at a SPRINT, for the verifier and the stage signs. */
const SPRINT_BALLISTIC: Ballistic = ballisticFor(
  BASE_PROFILE.moveSpeed * SPRINT.boost,
  BASE_PROFILE.jumpVelocity,
);

/**
 * The gap a stage should use, given how far through the run it is.
 *
 * Scaled from the RUN reach, never the sprint reach: a gap the sprint is
 * needed for is a gap a player with an empty bar cannot cross, and the bar
 * empties. The ceiling of 0.78 keeps every gap inside a beginner's own leap.
 */
const gapFor = (t: number): number => BASE_BALLISTIC.reach * (0.44 + t * 0.34);

/** The CLIMB a stage may ask for between two platforms. Well under the rise. */
const riseFor = (t: number): number => BASE_BALLISTIC.rise * (0.32 + t * 0.14);

const STAGE_TUNING: readonly StageTuning[] = [
  { name: 'Gates of Olympus', difficulty: 'EASY', recommendedLevel: 1 },
  { name: 'Cloud Steps', difficulty: 'EASY', recommendedLevel: 5 },
  { name: 'Pillar Garden', difficulty: 'EASY', recommendedLevel: 10 },
  { name: 'Thunder Bridge', difficulty: 'NORMAL', recommendedLevel: 18 },
  { name: 'Spear Fields', difficulty: 'NORMAL', recommendedLevel: 28 },
  { name: 'Ascension Stair', difficulty: 'NORMAL', recommendedLevel: 40 },
  { name: "Zeus's Arena", difficulty: 'HARD', recommendedLevel: 55 },
  { name: 'Wind Gallery', difficulty: 'HARD', recommendedLevel: 70 },
  { name: 'Halls of Hermes', difficulty: 'HARD', recommendedLevel: 90 },
  { name: 'Storm Peaks', difficulty: 'INSANE', recommendedLevel: 115 },
  { name: "Titan's Reach", difficulty: 'INSANE', recommendedLevel: 145 },
  { name: 'Throne of the Gods', difficulty: 'NIGHTMARE', recommendedLevel: 180 },
];

/**
 * Wins per stage. The ONE place a stage reward is written.
 *
 * Stage 1 pays a single token Win and the ladder climbs by roughly threefold
 * from there, so the last stage is worth half a million - which is what makes
 * the late unlock tables reachable at all.
 */
const STAGE_REWARDS = [
  1, 3, 10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 100_000, 500_000,
] as const;

export const stageReward = (index: number): number => {
  const at = Math.max(1, Math.floor(index));
  const authored = STAGE_REWARDS[at - 1];
  if (authored !== undefined) return authored;
  const last = STAGE_REWARDS[STAGE_REWARDS.length - 1] as number;
  return Math.round(last * 3 ** (at - STAGE_REWARDS.length));
};

/**
 * The win pad: at the player's LEFT at the stage end. LEFT IS POSITIVE X.
 *
 * The camera looks down +Z and its right is `(-cos yaw, sin yaw)`, which at
 * yaw 0 is world -X - so the player's left hand points at +X.
 */
export const WIN_PAD = {
  width: 9,
  length: 9,
  /** Distance in from the side wall. */
  insetX: 9,
  height: 0.45,
} as const;

/**
 * What the sea under a stage is made of. PRESENTATION ONLY - cloud, storm and
 * void kill by the same rule.
 */
const seaFor = (index: number): HazardPool['surface'] =>
  index === 4 || index === 10 ? 'storm' : index >= 11 ? 'void' : 'cloud';

/** First stage begins exactly where the hub floor ends. */
const FIRST_STAGE_Z: number = COURSE.lobbyEndZ;

const solids: CourseSolid[] = [];
const wideAreas: WideArea[] = [];
const sinking: SinkingSolid[] = [];
const pools: HazardPool[] = [];
const hazards: CourseHazard[] = [];
const decorations: Decoration[] = [];
const surfaces: SurfaceRegion[] = [];
const stages: StageDefinition[] = [];

/** A lateral position, as a fraction of the corridor's half-width. */
const lane = (fraction: number): number => COURSE.halfWidth * fraction;

const pushFloor = (
  stage: number,
  fromZ: number,
  toZ: number,
  kind: SolidKind = 'floor',
  topY: number = COURSE.floorY,
  halfWidth: number = COURSE.halfWidth,
): void => {
  if (toZ <= fromZ) return;
  solids.push({
    minX: -halfWidth,
    maxX: halfWidth,
    minY: topY - COURSE.floorThickness,
    maxY: topY,
    minZ: fromZ,
    maxZ: toZ,
    kind,
    stage,
  });
};

const pushBox = (
  stage: number,
  kind: SolidKind,
  centreX: number,
  baseY: number,
  centreZ: number,
  width: number,
  height: number,
  length: number,
): void => {
  solids.push({
    minX: centreX - width / 2,
    maxX: centreX + width / 2,
    minY: baseY,
    maxY: baseY + height,
    minZ: centreZ - length / 2,
    maxZ: centreZ + length / 2,
    kind,
    stage,
  });
};

/** A SUSPENDED platform: a slab with nothing under it. The course's unit. */
const pushIsland = (
  stage: number,
  kind: SolidKind,
  centreX: number,
  topY: number,
  centreZ: number,
  width: number,
  length: number,
  thickness = 1.4,
): void => {
  pushBox(stage, kind, centreX, topY - thickness, centreZ, width, thickness, length);
};

const markWide = (fromZ: number, toZ: number, halfWidth: number): void => {
  wideAreas.push({ minZ: fromZ, maxZ: toZ, halfWidth });
};

/** The cloud sea filling the corridor between two Z, at a stage's base. */
const pushPool = (
  stage: number,
  fromZ: number,
  toZ: number,
  baseY: number,
  surface: HazardPool['surface'] = 'cloud',
  halfWidth: number = COURSE.halfWidth,
): void => {
  pools.push({
    stage,
    surface,
    minX: -halfWidth - 40,
    maxX: halfWidth + 40,
    minZ: fromZ,
    maxZ: toZ,
    surfaceY: baseY - POOL_DROP,
    deathY: baseY - POOL_DROP - 1.5,
  });
};

/** A rotating arm of light: a row of hazard balls stepped out along a radius. */
const pushSpinArm = (
  stage: number,
  kind: HazardKind,
  centreX: number,
  centreZ: number,
  y: number,
  inner: number,
  outer: number,
  ballRadius: number,
  rate: number,
  phase: number,
): void => {
  const step = ballRadius * 1.5;
  for (let r = inner; r <= outer + 0.01; r += step) {
    hazards.push({ kind, stage, x: centreX, y, z: centreZ, radius: ballRadius, sweep: r, rate, phase, fromZ: 0, toZ: 0 });
  }
};

/** A thunder stone that falls onto a fixed spot and rises again. */
const pushFaller = (
  stage: number,
  x: number,
  z: number,
  radius: number,
  height: number,
  period: number,
  phase: number,
  baseY: number,
): void => {
  hazards.push({ kind: 'faller', stage, x, y: baseY + radius, z, radius, sweep: height, rate: period, phase, fromZ: 0, toZ: 0 });
};

/** A bed of golden spears across part of the corridor. */
const pushSpikeBed = (stage: number, centreX: number, z: number, width: number, y: number): void => {
  const radius = 1.3;
  const count = Math.max(1, Math.round(width / (radius * 1.6)));
  const step = count > 1 ? width / (count - 1) : 0;
  for (let i = 0; i < count; i += 1) {
    const x = centreX - width / 2 + step * i;
    hazards.push({ kind: 'spike', stage, x, y: y + radius * 0.75, z, radius, sweep: 0, rate: 0, phase: 0, fromZ: 0, toZ: 0 });
  }
};

/** A lightning bolt sweeping across the corridor. */
const pushSweeper = (
  stage: number,
  z: number,
  y: number,
  amplitude: number,
  rate: number,
  phase: number,
  radius = 1.4,
): void => {
  hazards.push({ kind: 'sweeper', stage, x: 0, y: y + radius, z, radius, sweep: amplitude, rate, phase, fromZ: 0, toZ: 0 });
};

const pushSurface = (
  stage: number,
  fromZ: number,
  toZ: number,
  halfWidth: number,
  grip: number,
  windX = 0,
  windZ = 0,
  boost = 0,
  centreX = 0,
): void => {
  surfaces.push({ stage, minX: centreX - halfWidth, maxX: centreX + halfWidth, minZ: fromZ, maxZ: toZ, grip, windX, windZ, boost });
};

/**
 * A LAUNCH PAD: a disc of divine light that throws the player upward.
 *
 * `boost` is a velocity, authored as a multiple of the base jump velocity so
 * the height it reaches is a known number of rises.
 */
const pushLaunchPad = (stage: number, x: number, y: number, z: number, size: number, boost: number): void => {
  pushBox(stage, 'launch', x, y - 0.3, z, size, 0.4, size);
  surfaces.push({ stage, minX: x - size / 2, maxX: x + size / 2, minZ: z - size / 2, maxZ: z + size / 2, grip: 1, windX: 0, windZ: 0, boost });
};

/** Columns along both edges of a stretch. Decoration only. */
const pushColumns = (stage: number, fromZ: number, toZ: number, y: number, spacing = 18, scale = 1): void => {
  for (let z = fromZ + spacing / 2; z < toZ; z += spacing) {
    for (const side of [-1, 1]) {
      decorations.push({ kind: 'column', stage, x: side * (COURSE.halfWidth - 2), y, z, scale, rotationY: 0 });
    }
  }
};

/** A drift of clouds beside a stretch, below platform height. */
const pushClouds = (stage: number, fromZ: number, toZ: number, y: number, spacing = 22): void => {
  let i = 0;
  for (let z = fromZ; z < toZ; z += spacing) {
    const side = i % 2 === 0 ? 1 : -1;
    decorations.push({ kind: 'cloud', stage, x: side * (COURSE.halfWidth + 14 + (i % 3) * 6), y: y - 6 - (i % 2) * 3, z, scale: 1 + (i % 3) * 0.25, rotationY: 0 });
    i += 1;
  }
};

// ---------------------------------------------------------------------------
// THE HUB.
//
// LEFT (+X): the three speed-upgrade rows, stepped up like terraces, with a
// stair at each end. RIGHT (-X): the three treadmills. On the back wall,
// behind the spawn: the three boards. Straight ahead: the golden gate.
// ---------------------------------------------------------------------------

solids.push({
  minX: -COURSE.lobbyHalfWidth,
  maxX: COURSE.lobbyHalfWidth,
  minY: COURSE.floorY - COURSE.floorThickness,
  maxY: COURSE.floorY,
  minZ: COURSE.lobbyStartZ,
  maxZ: COURSE.lobbyEndZ,
  kind: 'lobby',
  stage: -1,
});

/**
 * THE UPGRADE TERRACES, down the player's LEFT.
 *
 * Fifteen tiles in three rows of five. Row 1 is on the hub floor, row 2 is a
 * deck 2.4 up and row 3 another 2.4 above that, each stepped BACK (+X) like
 * terraces so all fifteen are in one shot from the spawn. Two stairways, one
 * at each end of the rows, climb along +X so a player walks TOWARD the tiles
 * as they rise; every riser is under `MOVEMENT.stepHeight`, so it is walked.
 */
export const UPGRADE_ROWS = {
  /** Centre X of each row's tiles, and the deck top each row stands on. */
  rowX: [42, 56, 70] as const,
  rowY: [0, 2.4, 4.8] as const,
  /** X extent of the decks rows 2 and 3 stand on. Row 1 is the floor. */
  deckMinX: [34, 49, 63] as const,
  deckMaxX: [49, 63, 78] as const,
  /** Z of the first tile in every row, and the spacing along the row. */
  firstZ: -118,
  spacingZ: 13,
  perRow: 5,
  /** Z extent of the decks: the tile rows plus both stair landings. */
  deckMinZ: -140,
  deckMaxZ: -44,
  /** Centre Z of the two stairways. Outside the tile rows, inside the decks. */
  stairZ: [-133, -51] as const,
  stairWidth: 10,
  /** The tile itself. */
  tileSize: 8,
  tileHeight: 0.4,
  /** How close the player must be to unlock from a tile. */
  claimRadius: 4.2,
} as const;

/** Which row (0-based) a 1-based upgrade slot sits in. */
export const upgradeRow = (slot: number): number =>
  Math.floor((Math.max(1, Math.floor(slot)) - 1) / UPGRADE_ROWS.perRow);

/** Centre X of an upgrade tile. */
export const upgradeTileX = (slot: number): number =>
  UPGRADE_ROWS.rowX[upgradeRow(slot)] ?? UPGRADE_ROWS.rowX[0];

/** Centre Z of an upgrade tile. */
export const upgradeTileZ = (slot: number): number => {
  const index = (Math.max(1, Math.floor(slot)) - 1) % UPGRADE_ROWS.perRow;
  return UPGRADE_ROWS.firstZ + index * UPGRADE_ROWS.spacingZ;
};

/** Top of the deck an upgrade tile stands on. */
export const upgradeTileY = (slot: number): number =>
  UPGRADE_ROWS.rowY[upgradeRow(slot)] ?? 0;

/**
 * The upgrade tile a position is standing on, or null.
 *
 * The ONE footprint test: the server that unlocks and the client that asks
 * both call it. All three axes, because the rows are at three heights.
 */
export const upgradeTileAt = (x: number, y: number, z: number): number | null => {
  for (const tier of SPEED_UPGRADES) {
    if (Math.abs(x - upgradeTileX(tier.slot)) > UPGRADE_ROWS.claimRadius) continue;
    if (Math.abs(z - upgradeTileZ(tier.slot)) > UPGRADE_ROWS.claimRadius) continue;
    const deck = upgradeTileY(tier.slot);
    if (y < deck - 1 || y > deck + 3) continue;
    return tier.slot;
  }
  return null;
};

// The two raised decks (row 1 stands on the floor).
for (const row of [1, 2] as const) {
  solids.push({
    minX: UPGRADE_ROWS.deckMinX[row],
    maxX: UPGRADE_ROWS.deckMaxX[row],
    minY: COURSE.floorY - COURSE.floorThickness,
    maxY: UPGRADE_ROWS.rowY[row],
    minZ: UPGRADE_ROWS.deckMinZ,
    maxZ: UPGRADE_ROWS.deckMaxZ,
    kind: 'deck',
    stage: -1,
  });
}

// The two stairways: floor -> row 2 deck -> row 3 deck, along +X.
for (const centreZ of UPGRADE_ROWS.stairZ) {
  const flights: Array<{ fromX: number; toX: number; fromY: number; toY: number }> = [
    { fromX: 40, toX: 49, fromY: COURSE.floorY, toY: UPGRADE_ROWS.rowY[1] },
    { fromX: 54, toX: 63, fromY: UPGRADE_ROWS.rowY[1], toY: UPGRADE_ROWS.rowY[2] },
  ];
  for (const flight of flights) {
    const rise = flight.toY - flight.fromY;
    const steps = Math.ceil(rise / 0.8);
    const tread = (flight.toX - flight.fromX) / steps;
    for (let i = 0; i < steps; i += 1) {
      const top = flight.fromY + ((i + 1) / steps) * rise;
      solids.push({
        minX: flight.fromX + i * tread,
        maxX: flight.fromX + (i + 1) * tread,
        minY: COURSE.floorY - COURSE.floorThickness,
        maxY: top,
        minZ: centreZ - UPGRADE_ROWS.stairWidth / 2,
        maxZ: centreZ + UPGRADE_ROWS.stairWidth / 2,
        kind: 'stair',
        stage: -1,
      });
    }
  }
}

// The fifteen tiles, standing proud of their decks.
for (const tier of SPEED_UPGRADES) {
  pushBox(
    -1,
    'tile',
    upgradeTileX(tier.slot),
    upgradeTileY(tier.slot),
    upgradeTileZ(tier.slot),
    UPGRADE_ROWS.tileSize,
    UPGRADE_ROWS.tileHeight,
    UPGRADE_ROWS.tileSize,
  );
}

/**
 * THE THREE BOARDS, on the BACK WALL of the spawn area, facing the course.
 *
 * Top Wins, Top Rebirths, Top Time - in that order along +X, standing on the
 * hub floor just in front of the back colonnade. Presentation reads the
 * positions; nothing in the simulation does.
 */
export const BOARDS = {
  x: [-32, 0, 32] as const,
  y: COURSE.floorY,
  z: COURSE.lobbyStartZ + 8,
  width: 20,
  height: 14,
} as const;

/**
 * THE TREADMILL BAY, on the player's RIGHT.
 *
 * THREE IDENTICAL BELTS. Every belt pays exactly what running the floor pays,
 * through the same per-step formula: a treadmill is a PLACE to farm, not a
 * better rate. The belts run along X with their consoles at the +X end, so a
 * runner faces the spawn - and they read as treadmills because the tread is a
 * long belt between two rails with a console at its head.
 */
export const TREADMILLS = {
  /** Raised bay deck, on the player's RIGHT - which is -X. */
  minX: -66,
  maxX: -30,
  minZ: -126,
  maxZ: -50,
  deckY: 0.5,
  /** The belt. Runs along X; the rigs step along Z. */
  beltLength: 10,
  beltWidth: 4.4,
  beltHeight: 0.5,
  columnX: -48,
  firstZ: -112,
  spacingZ: 24,
  count: 3,
  /**
   * Belt speed in world units per second: the base run speed, so a belt pays
   * what running the floor pays and the two really are one progression.
   */
  beltSpeed: MOVEMENT.moveSpeed,
} as const;

export const TREADMILL_COUNT = TREADMILLS.count;

export const treadmillZ = (index: number): number =>
  TREADMILLS.firstZ + (Math.max(1, Math.floor(index)) - 1) * TREADMILLS.spacingZ;

export const treadmillX = (_index: number): number => TREADMILLS.columnX;

/** Walkable height of every treadmill belt. */
export const TREADMILL_BELT_Y = TREADMILLS.deckY + TREADMILLS.beltHeight;

export const NO_TREADMILL = 0;

/**
 * Which treadmill a position is standing on, or 0.
 *
 * Derived from position ALONE, by both sides, every step. There is no
 * treadmill message: walking on starts it and walking off stops it.
 */
export const treadmillAt = (x: number, y: number, z: number): number => {
  if (y < TREADMILL_BELT_Y - 1.2 || y > TREADMILL_BELT_Y + 2.5) return NO_TREADMILL;
  if (Math.abs(x - TREADMILLS.columnX) > TREADMILLS.beltLength / 2) return NO_TREADMILL;
  for (let index = 1; index <= TREADMILL_COUNT; index += 1) {
    if (Math.abs(z - treadmillZ(index)) > TREADMILLS.beltWidth / 2) continue;
    return index;
  }
  return NO_TREADMILL;
};

solids.push({
  minX: TREADMILLS.minX,
  maxX: TREADMILLS.maxX,
  minY: COURSE.floorY - COURSE.floorThickness,
  maxY: TREADMILLS.deckY,
  minZ: TREADMILLS.minZ,
  maxZ: TREADMILLS.maxZ,
  kind: 'deck',
  stage: -1,
});

for (let i = 1; i <= TREADMILL_COUNT; i += 1) {
  pushBox(-1, 'deck', treadmillX(i), TREADMILLS.deckY, treadmillZ(i), TREADMILLS.beltLength, TREADMILLS.beltHeight, TREADMILLS.beltWidth);
  // The rails either side of the belt, so a runner has something to stand
  // between and the machine reads as a machine. Proud of the belt.
  for (const side of [-1, 1]) {
    pushBox(-1, 'block', treadmillX(i), TREADMILLS.deckY, treadmillZ(i) + side * (TREADMILLS.beltWidth / 2 + 0.55), TREADMILLS.beltLength + 1.2, 0.45, 1.0);
  }
  // The console at the +X head, which the runner faces.
  pushBox(-1, 'block', treadmillX(i) + TREADMILLS.beltLength / 2 + 1.1, TREADMILLS.deckY, treadmillZ(i), 1.4, 3.2, TREADMILLS.beltWidth + 2.2);
}

/**
 * THE GOLDEN GATE: two jambs at the mouth of the course.
 *
 * Solids, so the player walks THROUGH the gate rather than around it, and the
 * arch over it is decoration.
 */
for (const side of [-1, 1]) {
  pushBox(-1, 'wall', side * (COURSE.halfWidth + 3), COURSE.floorY, COURSE.lobbyEndZ - 2, 6, 16, 4);
}
decorations.push({ kind: 'arch', stage: -1, x: 0, y: COURSE.floorY, z: COURSE.lobbyEndZ - 2, scale: 1, rotationY: 0 });

// Braziers and statues around the spawn, so the open marble is not empty.
for (const [x, z] of [[-22, -128], [22, -128], [-22, -20], [22, -20]] as const) {
  decorations.push({ kind: 'brazier', stage: -1, x, y: COURSE.floorY, z, scale: 1.2, rotationY: 0 });
}
for (const [x, z, rot] of [[-30, -136, Math.PI / 4], [30, -136, -Math.PI / 4]] as const) {
  decorations.push({ kind: 'statue', stage: -1, x, y: COURSE.floorY, z, scale: 1.4, rotationY: rot });
}
// A ring of columns around the hub's edge.
for (let z = COURSE.lobbyStartZ + 12; z < COURSE.lobbyEndZ - 6; z += 26) {
  for (const side of [-1, 1]) {
    decorations.push({ kind: 'column', stage: -1, x: side * (COURSE.lobbyHalfWidth - 4), y: COURSE.floorY, z, scale: 1.4, rotationY: 0 });
  }
}
for (let x = -COURSE.lobbyHalfWidth + 14; x < COURSE.lobbyHalfWidth - 6; x += 26) {
  decorations.push({ kind: 'column', stage: -1, x, y: COURSE.floorY, z: COURSE.lobbyStartZ + 4, scale: 1.4, rotationY: 0 });
}
for (let i = 0; i < 10; i += 1) {
  decorations.push({ kind: 'cloud', stage: -1, x: -110 + i * 24, y: -8 - (i % 3) * 4, z: COURSE.lobbyStartZ - 30 - (i % 2) * 20, scale: 1.4 + (i % 3) * 0.3, rotationY: 0 });
}

// ---------------------------------------------------------------------------
// The stages.
// ---------------------------------------------------------------------------

/** Solid floor at the start of every stage, to land and re-aim on. */
const START_RUNWAY = 26;

/** Solid floor leading to the finish pads. */
const FINISH_APRON = 30;

/** Where a stage builder finished: the Z and the height of the last floor. */
interface Cursor {
  z: number;
  y: number;
}

/**
 * A CHAIN OF ISLANDS over the cloud sea - the course's primary pattern.
 *
 * @param gap     open air between islands, from `gapFor`
 * @param size    island width and length
 * @param rise    climb per island, from `riseFor`
 * @param weave   lateral swing as a lane fraction, alternating sides
 */
const pushIslandChain = (
  stage: number,
  from: Cursor,
  count: number,
  gap: number,
  size: number,
  rise: number,
  weave: number,
  kind: SolidKind = 'island',
): Cursor => {
  let z = from.z;
  let y = from.y;
  for (let i = 0; i < count; i += 1) {
    z += gap + size / 2;
    y += rise;
    const x = weave === 0 ? 0 : lane(weave) * (i % 2 === 0 ? 1 : -1) * (i % 3 === 2 ? 0.4 : 1);
    pushIsland(stage, kind, x, y, z, size, size);
    z += size / 2;
  }
  return { z, y };
};

/** A CLOUD that fades: a sinking island. */
const pushFadingCloud = (
  stage: number,
  x: number,
  y: number,
  z: number,
  size: number,
  phase: number,
): void => {
  sinking.push({
    minX: x - size / 2,
    maxX: x + size / 2,
    minY: y - 1.4,
    maxY: y,
    minZ: z - size / 2,
    maxZ: z + size / 2,
    kind: 'sinking',
    stage,
    cycle: 6,
    phase,
    steady: 2.6,
    warn: 1.0,
    sunk: 1.4,
    depth: 6,
  });
};

/** A golden SHUTTER: a sinking wall across the corridor. */
const pushShutter = (stage: number, z: number, y: number, phase: number, cycle = 5): void => {
  sinking.push({
    minX: -COURSE.halfWidth - 1,
    maxX: COURSE.halfWidth + 1,
    minY: y - 8,
    maxY: y + 6,
    minZ: z - 1,
    maxZ: z + 1,
    kind: 'sinking',
    stage,
    cycle,
    phase,
    steady: cycle * 0.4,
    warn: 0.8,
    sunk: cycle * 0.3,
    depth: 14,
  });
};

type Builder = (stage: number, from: Cursor, t: number) => Cursor;

/** 1. Gates of Olympus: a gentle chain of wide islands. Learn the jump. */
const buildGates: Builder = (stage, from, t) => {
  const end = pushIslandChain(stage, from, 5, gapFor(t) * 0.9, 11, 0, 0);
  pushColumns(stage, from.z, end.z, from.y, 20);
  pushClouds(stage, from.z, end.z, from.y);
  return end;
};

/** 2. Cloud Steps: rising clouds, the first that fade. */
const buildCloudSteps: Builder = (stage, from, t) => {
  let cursor = pushIslandChain(stage, from, 4, gapFor(t), 9, riseFor(t), 0.25, 'cloud');
  // Three fading clouds in a row, phased so one is always up.
  for (let i = 0; i < 3; i += 1) {
    cursor.z += gapFor(t) + 4.5;
    cursor.y += riseFor(t) * 0.6;
    pushFadingCloud(stage, lane(i % 2 === 0 ? 0.2 : -0.2), cursor.y, cursor.z, 9, i * 2);
    cursor.z += 4.5;
  }
  cursor = pushIslandChain(stage, cursor, 3, gapFor(t), 9, riseFor(t) * 0.5, -0.25, 'cloud');
  pushClouds(stage, from.z, cursor.z, from.y, 18);
  return cursor;
};

/** 3. Pillar Garden: a floor of pillars to weave through, and the first bolts. */
const buildPillarGarden: Builder = (stage, from, t) => {
  const length = 120;
  pushFloor(stage, from.z, from.z + length, 'floor', from.y);
  for (let i = 0; i < 9; i += 1) {
    const z = from.z + 12 + i * 12;
    const x = lane(i % 2 === 0 ? 0.35 : -0.35) * (i % 3 === 2 ? 0 : 1);
    pushBox(stage, 'pillar', x, from.y, z, 4, 14, 4);
  }
  pushSweeper(stage, from.z + 45, from.y, lane(0.55), 1.3, 0);
  pushSweeper(stage, from.z + 95, from.y, lane(0.55), 1.5, Math.PI);
  pushColumns(stage, from.z, from.z + length, from.y, 24);
  return { z: from.z + length, y: from.y };
};

/** 4. Thunder Bridge: a narrow bridge with stones falling onto it. */
const buildThunderBridge: Builder = (stage, from, t) => {
  const length = 130;
  pushBox(stage, 'bridge', 0, from.y - 1.2, from.z + length / 2, 6.5, 1.2, length);
  for (let i = 0; i < 6; i += 1) {
    pushFaller(stage, 0, from.z + 16 + i * 19, 2.4, 11, 3.4, i * 0.9, from.y);
  }
  // Two side bridges, so a player can step round a falling stone.
  pushBox(stage, 'bridge', lane(0.4), from.y - 1.2, from.z + 42, 5, 1.2, 26);
  pushBox(stage, 'bridge', lane(-0.4), from.y - 1.2, from.z + 88, 5, 1.2, 26);
  pushClouds(stage, from.z, from.z + length, from.y, 20);
  return { z: from.z + length, y: from.y };
};

/** 5. Spear Fields: plates with beds of spears between them. */
const buildSpearFields: Builder = (stage, from, t) => {
  let cursor: Cursor = { z: from.z, y: from.y };
  for (let i = 0; i < 5; i += 1) {
    const size = 14;
    cursor.z += gapFor(t) * 0.8 + size / 2;
    cursor.y += riseFor(t) * 0.5;
    pushIsland(stage, 'floor', 0, cursor.y, cursor.z, 40, size, 1.6);
    // Spears on alternate halves, so there is always a way round.
    const side = i % 2 === 0 ? 1 : -1;
    pushSpikeBed(stage, lane(0.45) * side, cursor.z, 18, cursor.y);
    cursor.z += size / 2;
  }
  pushColumns(stage, from.z, cursor.z, from.y, 26);
  return cursor;
};

/** 6. Ascension Stair: a climbing chain and a launch pad to the top. */
const buildAscension: Builder = (stage, from, t) => {
  let cursor = pushIslandChain(stage, from, 6, gapFor(t) * 0.85, 9, riseFor(t), 0.3);
  // A landing with a launch pad, throwing the player up two rises to a
  // plateau. Boost is a multiple of the base jump velocity.
  cursor.z += gapFor(t) * 0.8;
  pushIsland(stage, 'island', 0, cursor.y, cursor.z + 7, 16, 14, 1.6);
  pushLaunchPad(stage, 0, cursor.y, cursor.z + 8, 6, MOVEMENT.jumpVelocity * 1.45);
  cursor.z += 14;
  // The plateau begins ten units past the pad: a launch at a RUN covers that
  // while still rising, and lands well inside it. Further would need the sprint.
  const plateauY = cursor.y + BASE_BALLISTIC.rise * 1.45 * 1.45 * 0.7;
  cursor.z += 4;
  pushIsland(stage, 'floor', 0, plateauY, cursor.z + 12, 30, 24, 2);
  cursor = { z: cursor.z + 24, y: plateauY };
  pushClouds(stage, from.z, cursor.z, from.y, 20);
  return cursor;
};

/** 7. Zeus's Arena: a wide floor with beams of light sweeping round. */
const buildArena: Builder = (stage, from, t) => {
  const half = 34;
  const length = 120;
  pushFloor(stage, from.z, from.z + length, 'floor', from.y, half);
  markWide(from.z, from.z + length, half);
  pushSpinArm(stage, 'spinner', 0, from.z + 34, from.y + 1.4, 4, 24, 1.6, 1.1, 0);
  pushSpinArm(stage, 'spinner', 0, from.z + 34, from.y + 1.4, 4, 24, 1.6, 1.1, Math.PI);
  pushSpinArm(stage, 'spinner', 0, from.z + 86, from.y + 1.4, 4, 26, 1.6, -1.4, 0);
  pushSpinArm(stage, 'spinner', 0, from.z + 86, from.y + 1.4, 4, 26, 1.6, -1.4, Math.PI);
  // Hubs the arms turn on.
  pushBox(stage, 'pillar', 0, from.y, from.z + 34, 4, 6, 4);
  pushBox(stage, 'pillar', 0, from.y, from.z + 86, 4, 6, 4);
  for (const z of [from.z + 10, from.z + 60, from.z + 110]) {
    for (const side of [-1, 1]) {
      decorations.push({ kind: 'column', stage, x: side * (half - 3), y: from.y, z, scale: 1.3, rotationY: 0 });
    }
  }
  decorations.push({ kind: 'statue', stage, x: half - 6, y: from.y, z: from.z + 60, scale: 1.6, rotationY: -Math.PI / 2 });
  decorations.push({ kind: 'statue', stage, x: -half + 6, y: from.y, z: from.z + 60, scale: 1.6, rotationY: Math.PI / 2 });
  return { z: from.z + length, y: from.y };
};

/** 8. Wind Gallery: islands with a side wind that pushes the player off. */
const buildWindGallery: Builder = (stage, from, t) => {
  let cursor: Cursor = { z: from.z, y: from.y };
  for (let i = 0; i < 7; i += 1) {
    const size = 12;
    cursor.z += gapFor(t) * 0.85 + size / 2;
    cursor.y += riseFor(t) * 0.4;
    pushIsland(stage, 'island', 0, cursor.y, cursor.z, size + 6, size, 1.6);
    // The wind blows across the island, alternating direction.
    const push = (i % 2 === 0 ? 1 : -1) * 22;
    pushSurface(stage, cursor.z - size / 2, cursor.z + size / 2, size / 2 + 3, 1, push, 0);
    cursor.z += size / 2;
  }
  pushClouds(stage, from.z, cursor.z, from.y, 16);
  return cursor;
};

/** 9. Halls of Hermes: polished marble and golden shutters. */
const buildHalls: Builder = (stage, from, t) => {
  const length = 150;
  pushFloor(stage, from.z, from.z + length, 'ice', from.y);
  pushSurface(stage, from.z, from.z + length, COURSE.halfWidth, 0.3);
  for (let i = 0; i < 4; i += 1) {
    pushShutter(stage, from.z + 30 + i * 30, from.y, i * 1.25, 5);
  }
  pushSweeper(stage, from.z + 75, from.y, lane(0.6), 1.8, 0);
  pushColumns(stage, from.z, from.z + length, from.y, 20, 1.2);
  return { z: from.z + length, y: from.y };
};

/** 10. Storm Peaks: steep climbing clouds that fade, under falling stones. */
const buildStormPeaks: Builder = (stage, from, t) => {
  let cursor: Cursor = { z: from.z, y: from.y };
  for (let i = 0; i < 9; i += 1) {
    const size = 8.5;
    cursor.z += gapFor(t) * 0.9 + size / 2;
    cursor.y += riseFor(t);
    const x = lane(i % 2 === 0 ? 0.3 : -0.3);
    if (i % 3 === 1) pushFadingCloud(stage, x, cursor.y, cursor.z, size, i * 1.4);
    else pushIsland(stage, 'cloud', x, cursor.y, cursor.z, size, size);
    if (i % 4 === 2) pushFaller(stage, x, cursor.z, 2.2, 12, 3.6, i * 0.7, cursor.y);
    cursor.z += size / 2;
  }
  pushClouds(stage, from.z, cursor.z, from.y, 14);
  return cursor;
};

/** 11. Titan's Reach: the widest gaps in the game, and beams to time. */
const buildTitansReach: Builder = (stage, from, t) => {
  let cursor = pushIslandChain(stage, from, 4, gapFor(t), 8, riseFor(t) * 0.6, 0.35);
  // A landing with two spinners to weave between.
  cursor.z += gapFor(t) * 0.9;
  pushIsland(stage, 'floor', 0, cursor.y, cursor.z + 20, 44, 40, 2);
  pushSpinArm(stage, 'spinner', lane(0.5), cursor.z + 20, cursor.y + 1.4, 3, 14, 1.5, 1.6, 0);
  pushSpinArm(stage, 'spinner', lane(-0.5), cursor.z + 20, cursor.y + 1.4, 3, 14, 1.5, -1.6, 0);
  pushBox(stage, 'pillar', lane(0.5), cursor.y, cursor.z + 20, 3, 5, 3);
  pushBox(stage, 'pillar', lane(-0.5), cursor.y, cursor.z + 20, 3, 5, 3);
  cursor = { z: cursor.z + 40, y: cursor.y };
  cursor = pushIslandChain(stage, cursor, 5, gapFor(t), 7.5, riseFor(t) * 0.7, -0.35);
  pushClouds(stage, from.z, cursor.z, from.y, 14);
  return cursor;
};

/** 12. Throne of the Gods: everything at once, then a launch to the throne. */
const buildThrone: Builder = (stage, from, t) => {
  const runway = 40;
  pushFloor(stage, from.z, from.z + runway, 'floor', from.y);
  pushSweeper(stage, from.z + 14, from.y, lane(0.6), 2.0, 0);
  pushSweeper(stage, from.z + 30, from.y, lane(0.6), 2.0, Math.PI);
  let cursor: Cursor = { z: from.z + runway, y: from.y };
  for (let i = 0; i < 6; i += 1) {
    const size = 8;
    cursor.z += gapFor(t) * 0.95 + size / 2;
    cursor.y += riseFor(t);
    const x = lane(i % 2 === 0 ? 0.3 : -0.3);
    if (i % 2 === 1) pushFadingCloud(stage, x, cursor.y, cursor.z, size, i * 1.1);
    else pushIsland(stage, 'island', x, cursor.y, cursor.z, size, size);
    cursor.z += size / 2;
  }
  // Spear plates.
  for (let i = 0; i < 3; i += 1) {
    cursor.z += gapFor(t) * 0.8 + 7;
    pushIsland(stage, 'floor', 0, cursor.y, cursor.z, 36, 14, 1.6);
    pushSpikeBed(stage, lane(i % 2 === 0 ? 0.5 : -0.5), cursor.z, 16, cursor.y);
    cursor.z += 7;
  }
  // The final launch, up to the throne.
  cursor.z += gapFor(t) * 0.8;
  pushIsland(stage, 'island', 0, cursor.y, cursor.z + 7, 16, 14, 1.6);
  pushLaunchPad(stage, 0, cursor.y, cursor.z + 8, 6, MOVEMENT.jumpVelocity * 1.6);
  cursor.z += 14;
  const throneY = cursor.y + BASE_BALLISTIC.rise * 1.6 * 1.6 * 0.7;
  // Eight units past the pad, for the same reason as the Ascension plateau.
  cursor.z += 2;
  pushIsland(stage, 'floor', 0, throneY, cursor.z + 14, 40, 28, 2.4);
  decorations.push({ kind: 'statue', stage, x: 0, y: throneY, z: cursor.z + 26, scale: 2.4, rotationY: Math.PI });
  for (const side of [-1, 1]) {
    decorations.push({ kind: 'column', stage, x: side * 16, y: throneY, z: cursor.z + 24, scale: 1.8, rotationY: 0 });
  }
  return { z: cursor.z + 28, y: throneY };
};

const BUILDERS: readonly Builder[] = [
  buildGates,
  buildCloudSteps,
  buildPillarGarden,
  buildThunderBridge,
  buildSpearFields,
  buildAscension,
  buildArena,
  buildWindGallery,
  buildHalls,
  buildStormPeaks,
  buildTitansReach,
  buildThrone,
];

let cursor: Cursor = { z: FIRST_STAGE_Z, y: COURSE.floorY };

for (let i = 0; i < COURSE.stageCount; i += 1) {
  const index = i + 1;
  const tuning = STAGE_TUNING[i] as StageTuning;
  const builder = BUILDERS[i] as Builder;
  const t = COURSE.stageCount > 1 ? i / (COURSE.stageCount - 1) : 0;

  const startZ = cursor.z;
  const startY = cursor.y;

  // The runway: solid floor to land on and re-aim, at the stage's own height.
  pushFloor(index, startZ, startZ + START_RUNWAY, 'floor', startY);

  const built = builder(index, { z: startZ + START_RUNWAY, y: startY }, t);

  // The finish apron with the two pads, at the height the stage reached.
  const apronZ = built.z;
  const endY = built.y;
  pushFloor(index, apronZ, apronZ + FINISH_APRON, 'floor', endY);
  // ONE cloud sea under the whole stage, at its lowest floor: what a player who
  // leaves a platform lands in, and the reason a fall is never a long drop.
  pushPool(index, startZ, apronZ + FINISH_APRON, Math.min(startY, endY), seaFor(index));

  const padZ = apronZ + FINISH_APRON / 2;
  const winPadX = COURSE.halfWidth - WIN_PAD.insetX;
  pushBox(index, 'winPad', winPadX, endY, padZ, WIN_PAD.width, WIN_PAD.height, WIN_PAD.length);

  const endZ = apronZ + FINISH_APRON;

  stages.push({
    index,
    name: tuning.name,
    difficulty: tuning.difficulty,
    recommendedLevel: tuning.recommendedLevel,
    recommendedSpeed: totalSpeedToReach(tuning.recommendedLevel),
    startZ,
    endZ,
    startY,
    endY,
    winPadX,
    winPadZ: padZ,
    padY: endY + WIN_PAD.height,
    winReward: stageReward(index),
  });

  // The bridge to the next stage: a solid connector at the apron's height.
  if (i < COURSE.stageCount - 1) {
    pushFloor(index, endZ, endZ + COURSE.stageGap, 'floor', endY);
    pushPool(index, endZ, endZ + COURSE.stageGap, endY);
    cursor = { z: endZ + COURSE.stageGap, y: endY };
  } else {
    cursor = { z: endZ, y: endY };
  }
}

/** Every solid, in build order. Read by the renderer and the collision model. */
export const COURSE_SOLIDS: readonly CourseSolid[] = solids;
export const SINKING_SOLIDS: readonly SinkingSolid[] = sinking;
export const QUICKSAND: readonly HazardPool[] = pools;
export const COURSE_HAZARDS: readonly CourseHazard[] = hazards;
export const DECORATIONS: readonly Decoration[] = decorations;
export const STAGES: readonly StageDefinition[] = stages;

/** The base ballistic figures, exported so the verifier checks the rule. */
export const BALLISTIC_REACH = BASE_BALLISTIC.reach;
export const BALLISTIC_RISE = BASE_BALLISTIC.rise;
export const SPRINT_REACH = SPRINT_BALLISTIC.reach;

/** The upgrade roster, re-exported for the verifier's tile checks. */
export const COURSE_UPGRADES: readonly SpeedUpgrade[] = SPEED_UPGRADES;

/**
 * THE HARD END OF THE GAME. Z past which there is no more world. A CLAMP.
 */
export const COURSE_END_Z: number =
  (stages[stages.length - 1]?.endZ ?? COURSE.lobbyEndZ) - 2;

/** The highest point of the course, for the sky and the fog. */
export const COURSE_TOP_Y: number = cursor.y;

/** How far a sinking platform has dropped at a given time. The ONE definition. */
export const sinkingOffsetAt = (
  platform: SinkingSolid,
  time: number,
): { drop: number; warning: boolean } => {
  const cycle = Math.max(0.1, platform.cycle);
  let t = (time + platform.phase) % cycle;
  if (t < 0) t += cycle;

  const steadyEnd = platform.steady;
  const warnEnd = steadyEnd + platform.warn;
  const sinkEnd = warnEnd + 0.45;
  const sunkEnd = sinkEnd + platform.sunk;

  if (t < steadyEnd) return { drop: 0, warning: false };
  if (t < warnEnd) return { drop: 0, warning: true };
  if (t < sinkEnd) {
    const k = (t - warnEnd) / 0.45;
    return { drop: platform.depth * k * k, warning: false };
  }
  if (t < sunkEnd) return { drop: platform.depth, warning: false };

  const rise = Math.max(0.2, cycle - sunkEnd);
  const k = Math.min((t - sunkEnd) / rise, 1);
  return { drop: platform.depth * (1 - k), warning: false };
};

/** Where a hazard is at a given time. The ONE definition. Allocates nothing. */
export const hazardPositionAt = (
  hazard: CourseHazard,
  time: number,
  out: { x: number; y: number; z: number },
): void => {
  out.x = hazard.x;
  out.y = hazard.y;
  out.z = hazard.z;

  switch (hazard.kind) {
    case 'spike':
      return;
    case 'roller': {
      const span = Math.max(1, hazard.fromZ - hazard.toZ);
      let travelled = (time * hazard.rate + hazard.phase) % span;
      if (travelled < 0) travelled += span;
      out.z = hazard.fromZ - travelled;
      return;
    }
    case 'spinner':
    case 'tornado': {
      const angle = time * hazard.rate + hazard.phase;
      out.x = hazard.x + hazard.sweep * Math.cos(angle);
      out.z = hazard.z + hazard.sweep * Math.sin(angle);
      return;
    }
    case 'faller':
      out.y = fallerHeightAt(hazard, time);
      return;
    default:
      out.x = hazard.x + hazard.sweep * Math.sin(time * hazard.rate + hazard.phase);
  }
};

/** Height of a faller at a given time. */
export const fallerHeightAt = (hazard: CourseHazard, time: number): number => {
  const period = Math.max(0.6, hazard.rate);
  let t = (time + hazard.phase) % period;
  if (t < 0) t += period;

  const hoverEnd = period * 0.52;
  const fallEnd = hoverEnd + period * 0.1;
  const restEnd = fallEnd + period * 0.14;

  if (t < hoverEnd) return hazard.y + hazard.sweep;
  if (t < fallEnd) {
    const k = (t - hoverEnd) / (fallEnd - hoverEnd);
    return hazard.y + hazard.sweep * (1 - k * k);
  }
  if (t < restEnd) return hazard.y;

  const k = (t - restEnd) / Math.max(0.1, period - restEnd);
  return hazard.y + hazard.sweep * k * (2 - k);
};

/** How far from the centreline a hazard can ever get. */
export const hazardReachX = (hazard: CourseHazard): number => {
  switch (hazard.kind) {
    case 'sweeper':
    case 'spinner':
    case 'tornado':
      return Math.abs(hazard.x) + Math.abs(hazard.sweep) + hazard.radius;
    default:
      return Math.abs(hazard.x) + hazard.radius;
  }
};

/** The Z range a hazard can ever reach, for the collision index's buckets. */
export const hazardZRange = (hazard: CourseHazard): { minZ: number; maxZ: number } => {
  switch (hazard.kind) {
    case 'roller':
      return { minZ: hazard.toZ - hazard.radius, maxZ: hazard.fromZ + hazard.radius };
    case 'spinner':
    case 'tornado':
      return {
        minZ: hazard.z - Math.abs(hazard.sweep) - hazard.radius,
        maxZ: hazard.z + Math.abs(hazard.sweep) + hazard.radius,
      };
    default:
      return { minZ: hazard.z - hazard.radius, maxZ: hazard.z + hazard.radius };
  }
};

/** Half-width of the playable corridor at a given Z. */
export const corridorHalfWidthAt = (z: number): number => {
  if (z <= COURSE.lobbyEndZ) return COURSE.lobbyHalfWidth;
  for (const area of wideAreas) {
    if (z >= area.minZ && z <= area.maxZ) return area.halfWidth;
  }
  return COURSE.halfWidth;
};

/** Every stretch wider than the corridor, the hub included. */
export const WIDE_AREAS: readonly WideArea[] = [
  { minZ: COURSE.lobbyStartZ, maxZ: COURSE.lobbyEndZ, halfWidth: COURSE.lobbyHalfWidth },
  ...wideAreas,
];

/** The stage containing this Z, or null. */
export const stageAt = (z: number): StageDefinition | null => {
  for (const stage of stages) {
    if (z >= stage.startZ && z <= stage.endZ) return stage;
  }
  return null;
};

/** The height of the course floor nearest a Z, for the fog and the sky. */
export const courseHeightAt = (z: number): number => {
  if (z <= COURSE.lobbyEndZ) return COURSE.floorY;
  const stage = stageAt(z);
  if (!stage) return COURSE_TOP_Y;
  const t = (z - stage.startZ) / Math.max(1, stage.endZ - stage.startZ);
  return stage.startY + (stage.endY - stage.startY) * t;
};

/** The stage whose win pad the player is standing on, or null. */
export const winPadAt = (x: number, y: number, z: number): StageDefinition | null => {
  for (const stage of stages) {
    if (Math.abs(z - stage.winPadZ) > WIN_PAD.length / 2) continue;
    if (Math.abs(x - stage.winPadX) > WIN_PAD.width / 2) continue;
    if (y < stage.padY - 1.5 || y > stage.padY + 5) continue;
    return stage;
  }
  return null;
};

export const SURFACE_REGIONS: readonly SurfaceRegion[] = surfaces;

/** The surface a position is standing on, or null. First match wins. */
export const surfaceAt = (x: number, z: number): SurfaceRegion | null => {
  for (const region of surfaces) {
    if (x < region.minX || x > region.maxX) continue;
    if (z < region.minZ || z > region.maxZ) continue;
    return region;
  }
  return null;
};

/** The lethal pool a position is inside, or null. */
export const quicksandAt = (x: number, z: number): HazardPool | null => {
  for (const pit of pools) {
    if (x < pit.minX || x > pit.maxX) continue;
    if (z < pit.minZ || z > pit.maxZ) continue;
    return pit;
  }
  return null;
};
