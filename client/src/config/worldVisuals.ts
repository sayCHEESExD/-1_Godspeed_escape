/**
 * THE PALETTE: Olympus at midday.
 *
 * COLOUR ONLY. Every world coordinate lives in `@godspeed/shared`'s course
 * config, so this file re-themes the entire game without moving a collider.
 *
 * Five colours doing five jobs, and a colour is a PROMISE here:
 *
 *  - MARBLE is the ground: white paving, fluted columns, the hub. Bright, so
 *    the world reads as a place in the sky rather than a grey ruin.
 *  - GOLD is the REWARD and the trim: win pads, capitals, the gate, the
 *    inlay. It is never used on a hazard.
 *  - CYAN is divine ENERGY: launch pads, the energy platforms, treadmill
 *    screens. It means "this helps you".
 *  - CLOUD is the soft white below and beside everything: walkable clouds,
 *    the cloud sea, the fading platforms.
 *  - CRIMSON is what KILLS you: lightning bolts, spears, thunder stones. No
 *    stage may use it for anything else.
 */
export const PALETTE = {
  /** Marble paving: the course floor and the hub. */
  marble: '#f4efe4',
  marbleVein: '#d8d0c0',
  marbleInlay: '#e3b74a',
  /** The hub's paving: the same marble with a warmer inlay. */
  lobbyMarble: '#f6f1e6',
  lobbyInlay: '#f0c040',

  /** Fluted column stone, walls, pillars. */
  column: '#ece6d8',
  columnShade: '#c9c0ae',
  columnFlute: 'rgba(0,0,0,0.12)',

  /** Gold: trim, capitals, the win plate. */
  gold: 0xf0c040,
  goldDark: 0xa87b12,
  goldBright: 0xffe08a,

  /** Divine energy. */
  energy: 0x35e0ff,
  energyBright: 0xd6f9ff,
  energyDeep: 0x0f6f8f,

  /** Clouds: the walkable ones and the sea. */
  cloud: '#ffffff',
  cloudShade: '#dbe9f7',
  cloudSea: '#f2f7ff',
  cloudSeaShade: '#c7dbf2',
  stormSea: '#6a7fa0',
  stormSeaShade: '#3e4d66',
  voidSea: '#1a1436',
  voidSeaShade: '#0c0a1e',

  /** THE HAZARDS. Crimson, all of them. */
  hazard: 0xff4a3d,
  hazardCore: 0xfff0b0,
  spike: 0xb8a05a,
  spikeTip: 0xff5a3d,
  stone: 0x6b6f7a,
  stoneDark: 0x3f434d,
  impactWarn: 0x8b1a10,

  /** Win pad plate, and the return pad opposite it. */
  winPad: '#f4c341',
  winPadAlt: '#ffe9a6',
  winPadRim: 0x8f6a10,

  /** The treadmills. */
  treadmillFrame: 0x2c3b52,
  treadmillFrameLit: 0x35e0ff,
  treadmillBelt: '#2a2e38',
  treadmillMark: '#ffd54a',
  treadmillDeck: '#3b6fb8',
  treadmillDeckDark: '#2a4f85',

  /** Upgrade tiles: a dark plinth with a lit face. */
  tileBase: 0x2a3348,
  tileLocked: 0x54607a,
  tileGlow: 0xffe066,

  /** Polished marble. */
  ice: '#e8f4ff',
  iceBright: '#ffffff',

  /** Boards: dark slate in a gold frame. */
  boardFrame: 0xd9b24a,
  boardFrameDark: 0x8a6a16,
  boardPanel: '#152036',
  boardPanelEdge: '#2b3b5c',
  boardStripe: 'rgba(255, 224, 138, 0.06)',
  boardInk: '#050912',
  boardHeading: '#ffe08a',
  boardName: '#ffffff',
  boardValue: '#7fe6ff',

  /** Sky and fog. Bright, blue and hazy at the horizon. */
  skyTop: 0x2f8be6,
  sky: 0x7fc4ff,
  fog: 0xd9ecff,
  skyCloud: 0xffffff,
  skyCloudShade: 0xd6e6f7,

  /** A sinking cloud about to fade flushes toward this. */
  sinkingWarn: 0xffb0a0,

  /** Braziers and statues. */
  brazierFlame: 0xffb33a,
  statueGold: 0xe8b93a,

  /** Olive trees. */
  trunk: 0x7a5a3a,
  canopy: 0x6f9a4a,
  canopyShade: 0x4f7a34,
} as const;

/** Fog band. Held back so the fog is depth rather than a curtain. */
export const WORLD_FOG = {
  near: 260,
  far: 900,
} as const;

/** Yaw correction for the supplied player FBX. It already faces +Z. */
export const PLAYER_MODEL_YAW_OFFSET = 0;

/**
 * THE SECTION ACCENT: one lit colour per stage.
 *
 * The architecture is the same marble the whole way up; the light on the
 * braziers, the beams and the gate trim is what tells a player which part of
 * Olympus they are in. Gold at the gates, cyan through the clouds, violet in
 * the storms, and white at the throne.
 */
export const STAGE_ACCENT: readonly number[] = [
  0xf0c040, // 1  Gates of Olympus
  0x7fe6ff, // 2  Cloud Steps
  0xf0c040, // 3  Pillar Garden
  0x9bd4ff, // 4  Thunder Bridge
  0xffb33a, // 5  Spear Fields
  0x35e0ff, // 6  Ascension Stair
  0xffe066, // 7  Zeus's Arena
  0xb8f0ff, // 8  Wind Gallery
  0xffd54a, // 9  Halls of Hermes
  0xb388ff, // 10 Storm Peaks
  0xff8ad8, // 11 Titan's Reach
  0xffffff, // 12 Throne of the Gods
];

export const accentForStage = (stage: number): number =>
  STAGE_ACCENT[stage - 1] ?? PALETTE.gold;
