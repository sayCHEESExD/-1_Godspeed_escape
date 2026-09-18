import type { Vec3 } from '../types/math.js';

/**
 * World-space constants shared by the renderer and the authoritative server.
 *
 * Units are "world units" (1 unit ~= 1 Roblox stud in feel). The supplied
 * player.fbx is authored at 320 units tall, so it is scaled down on load.
 */

/** Multiplier applied to the loaded FBX so the character is PLAYER_HEIGHT tall. */
export const FBX_TO_WORLD_SCALE = 0.01;

/** Player height in world units (320 * FBX_TO_WORLD_SCALE). */
export const PLAYER_HEIGHT = 3.2;

/**
 * Horizontal half-width of the player's collision body.
 *
 * A cylinder, because the character turns: modelling the shoulders would mean
 * a rotating box against an axis-aligned course, which is a solver rather than
 * a radius. A little wider than the model's hips so the feet can stand on a
 * platform edge rather than falling the instant the centre passes it.
 */
export const PLAYER_RADIUS = 0.8;

/**
 * How large the head is drawn.
 *
 * Roblox-style proportions: the head is a fifth of the character, and the
 * supplied rig's head is a little smaller than that. Applied to the neck bone
 * by `PlayerRig`, and multiplied with the portal's own head proportion so a
 * player's choice still does what they chose.
 */
export const HEAD_SCALE = 1.12;

export const neckScale = (portalHeadScale = 1): number => {
  const chosen =
    Number.isFinite(portalHeadScale) && portalHeadScale > 0 ? portalHeadScale : 1;
  return HEAD_SCALE * chosen;
};

/** The course runs along +Z. Players travel *along* it, never across it. */
export const COURSE_FORWARD_AXIS = 'z' as const;

/**
 * Spawn transform: the middle of the spawn hub.
 *
 * Clear of both feature areas - the speed upgrade rows down the player's LEFT
 * and the treadmills on their RIGHT - so the game opens on the open marble
 * with both in shot and the golden gate of the course straight ahead.
 */
export const SPAWN_POSITION: Readonly<Vec3> = { x: 0, y: 0, z: -78 };

/** Spawn yaw in radians (facing +Z, down the course). */
export const SPAWN_ROTATION_Y = 0;

/**
 * Y below which the player has fallen out of the world.
 *
 * The hub floats in the sky; below it is the cloud sea. Sits well under the
 * hub floor so a fall reads as dropping through the clouds rather than
 * blinking out at the edge.
 */
export const DEATH_PLANE_Y = -18;

/**
 * Seconds a dead player LIES WHERE THEY FELL before being placed at the spawn.
 *
 * A death has two halves: the character is frozen at the point it died with
 * its fall-over playing for everyone who can see it, and only then is it
 * placed. Shared because both sides agree on it - the client's `DEATH.duration`
 * is this number.
 */
export const DEATH_HOLD_SECONDS = 0.55;

/**
 * Extra seconds the SERVER waits beyond the animation before placing.
 *
 * The client predicts its own death a hair before the server confirms it, so a
 * hold exactly as long as the animation could place the player before the
 * fall-over finished.
 */
export const DEATH_PLACE_MARGIN = 0.1;
