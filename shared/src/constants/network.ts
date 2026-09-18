/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'godspeedescape';

/**
 * Default server port. Override with the PORT env var on the server.
 *
 * Deliberately NOT 2567: the earlier games in this series occupy 2567-2574 on
 * the same machine, and sharing a port means whichever server starts first
 * silently serves both clients.
 */
export const DEFAULT_SERVER_PORT = 2575;

/**
 * Most players in ONE room.
 *
 * The matchmaker locks a room at this figure and opens another, so a
 * sixteenth player gets a new room rather than a refusal - which is what
 * "routed, not rejected" means here.
 */
export const MAX_PLAYERS_PER_ROOM = 15;

/**
 * How many OTHER players are drawn at once.
 *
 * A RENDERING limit, not a networking one: every player in the room is
 * tracked and synchronised on every patch, only the nearest few are added to
 * the scene. A character here is one skinned mesh, a nameplate and its
 * effects, so this is more generous than the mech game's two - but a room of
 * fifteen sprinting god-powers is still most of a phone's frame budget.
 */
export const VISIBLE_REMOTE_PLAYERS = 6;

/**
 * How many of the visible remotes get FULL sprint effects.
 *
 * The rest keep their aura and trail but run the sprint effect at its
 * reduced budget. Effects are the expensive part of a player, and this is what
 * stops fifteen clients each simulating fifteen full particle rigs.
 */
export const FULL_EFFECT_REMOTE_PLAYERS = 3;

/** Server simulation / state broadcast rate, in Hz. */
export const SERVER_TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/**
 * Client->server and server->client message identifiers.
 *
 * A const object rather than an enum so it survives `verbatimModuleSyntax` and
 * erases cleanly in both build pipelines.
 */
export const MessageType = {
  /** Client -> server: one frame of INPUT. Never a transform. */
  Move: 'move',
  /** Server -> client: authoritative respawn instruction. */
  Respawn: 'respawn',
  /** Client -> server: "I think I finished a stage." A request, never a grant. */
  ClaimStage: 'claimStage',
  /** Client -> server: "put me back at the spawn". */
  RequestRespawn: 'requestRespawn',
  /** Server -> client: a stage reward was granted. Drives the celebration. */
  StageAwarded: 'stageAwarded',
  /** Client -> server: "rebirth me". Carries nothing. */
  Rebirth: 'rebirth',
  /** Client -> server: "I am standing on this speed upgrade tile, unlock it." */
  UnlockUpgrade: 'unlockUpgrade',
  /** Client -> server: unlock the trail in this slot. */
  UnlockTrail: 'unlockTrail',
  /** Client -> server: wear an OWNED trail, or 0 to take it off. */
  EquipTrail: 'equipTrail',
  /** Client -> server: unlock the aura in this slot. */
  UnlockAura: 'unlockAura',
  /** Client -> server: wear an OWNED aura, or 0 to take it off. */
  EquipAura: 'equipAura',
  /** Client -> server: buy the charm in a shop slot. */
  BuyCharm: 'buyCharm',
  /** Client -> server: equip an OWNED charm. */
  EquipCharm: 'equipCharm',
  /** Client -> server: take an equipped charm off. */
  UnequipCharm: 'unequipCharm',
  /** Client -> server: "this is what my Bloxity avatar looks like". */
  SetAvatar: 'setAvatar',
  /** Client -> server: the player's Bloxity DISPLAY NAME and portrait. */
  SetIdentity: 'setIdentity',
  /**
   * Client -> server: the portal's game TOKEN, or null when signed out. Sent
   * whenever the login changes mid-session. Never an account id: the server
   * asks Bloxity who the token belongs to.
   */
  SetAuth: 'setAuth',
  /** Server -> client: whose progress this session is now playing on. */
  AuthState: 'authState',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
