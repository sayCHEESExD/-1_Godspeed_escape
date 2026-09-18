import { surfaceAt, treadmillAt } from '../config/course.js';
import { MOVEMENT } from '../config/movement.js';
import { SPRINT, sprintDrainPerSecond } from '../config/sprint.js';
import { PLAYER_HEIGHT, SPAWN_POSITION, SPAWN_ROTATION_Y } from '../constants/world.js';
import { rotateTowards } from '../types/math.js';
import type { WorldCollision } from './WorldCollision.js';

/**
 * The authoritative physics step, shared by the server and by client
 * prediction.
 *
 * This is THE movement simulation. The server runs it to own the result and
 * the client runs the identical function to predict ahead of the network, so
 * the two can only ever disagree through inputs, never through different
 * maths. Do not reimplement any part of it anywhere else.
 *
 * THE SPRINT LIVES HERE. It changes where the player goes, so its energy, its
 * drain, its refill and its boost are all part of the shared step: the server
 * owns the bar and the client predicts it with the same numbers.
 *
 * Deliberately framework-free and allocation-free.
 */

/** Everything that makes up a player's physical state. */
export interface PlayerMotion {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  /** Edge-detect for the jump control, so a hold is one leap, not sixty. */
  jumpLatched: boolean;
  /** Monotonic count of jumps, replicated so remotes can mirror them. */
  jumpCount: number;
  /** Treadmill the player is standing on, or 0. Derived from position. */
  treadmill: number;
  /** Seconds of coyote time left. */
  coyote: number;
  /** Sprint energy, 0..SPRINT.maxEnergy. */
  sprintEnergy: number;
  /** True while the god power is running. */
  sprinting: boolean;
  /** True from the bar running dry until it has recovered `minToRestart`. */
  sprintLocked: boolean;
  /** Seconds since the sprint key was last held, for the regen delay. */
  sprintRest: number;
}

/** One frame of player intent. Carries no position - only what was pressed. */
export interface MovementInput {
  moveX: number;
  moveZ: number;
  jump: boolean;
  /** The sprint key, held. */
  sprint: boolean;
  cameraYaw: number;
}

/** Server-owned tuning the step reads but never changes. */
export interface SimParams {
  /** Authoritative movement multiplier from level and rebirths. */
  moveMultiplier: number;
  /** Authoritative jump velocity, resolved by the one shared formula. */
  jumpVelocity: number;
  /** Multiplier on sprint capacity from charms. 1 is the base bar. */
  sprintCapacity: number;
  /** The world clock, in seconds. */
  time: number;
}

/** Edges this step produced, consumed by the animator. */
export interface SimEvents {
  jumpStarted: boolean;
  landed: boolean;
  /** True on the step the sprint switched on. */
  sprintStarted: boolean;
}

/** Largest single step the simulation will take, in seconds. */
export const MAX_SIM_DELTA = 0.1;

/** Seconds after leaving the ground during which a jump still counts. */
const COYOTE_TIME = 0.11;

export const createMotion = (): PlayerMotion => ({
  x: SPAWN_POSITION.x,
  y: SPAWN_POSITION.y,
  z: SPAWN_POSITION.z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: SPAWN_ROTATION_Y,
  grounded: true,
  jumpLatched: false,
  jumpCount: 0,
  treadmill: 0,
  coyote: 0,
  sprintEnergy: SPRINT.maxEnergy,
  sprinting: false,
  sprintLocked: false,
  sprintRest: 1,
});

export const createSimEvents = (): SimEvents => ({
  jumpStarted: false,
  landed: false,
  sprintStarted: false,
});

export const createMovementInput = (): MovementInput => ({
  moveX: 0,
  moveZ: 0,
  jump: false,
  sprint: false,
  cameraYaw: 0,
});

/** Copy motion state, e.g. when snapping prediction to the server. */
export const copyMotion = (from: PlayerMotion, to: PlayerMotion): void => {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
  to.grounded = from.grounded;
  to.jumpLatched = from.jumpLatched;
  to.jumpCount = from.jumpCount;
  to.treadmill = from.treadmill;
  to.coyote = from.coyote;
  to.sprintEnergy = from.sprintEnergy;
  to.sprinting = from.sprinting;
  to.sprintLocked = from.sprintLocked;
  to.sprintRest = from.sprintRest;
};

/**
 * Reset to a spawn transform. Used by both sides on respawn.
 *
 * The sprint bar is deliberately NOT refilled: a death is not a rest.
 */
export const resetMotion = (
  motion: PlayerMotion,
  x = SPAWN_POSITION.x,
  y = SPAWN_POSITION.y,
  z = SPAWN_POSITION.z,
  yaw = SPAWN_ROTATION_Y,
): void => {
  motion.x = x;
  motion.y = y;
  motion.z = z;
  motion.vx = 0;
  motion.vy = 0;
  motion.vz = 0;
  motion.yaw = yaw;
  motion.grounded = true;
  motion.jumpLatched = false;
  motion.treadmill = 0;
  motion.coyote = 0;
  motion.sprinting = false;
};

export const horizontalSpeed = (motion: PlayerMotion): number =>
  Math.hypot(motion.vx, motion.vz);

/** Sanitise one input before it is simulated. Applied on the SERVER. */
export const sanitiseInput = (
  input: Partial<MovementInput> | undefined,
): MovementInput => {
  const finite = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  let moveX = finite(input?.moveX);
  let moveZ = finite(input?.moveZ);
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }

  return {
    moveX,
    moveZ,
    jump: input?.jump === true,
    sprint: input?.sprint === true,
    cameraYaw: finite(input?.cameraYaw),
  };
};

/** Scratch for the boundary clamp. Single-threaded, so sharing is safe. */
const BOUNDS = { x: 0, z: 0 };

/**
 * Advance one player by one step.
 *
 * @param motion    mutated in place
 * @param input     already sanitised intent
 * @param params    server-owned tuning
 * @param delta     seconds; clamped internally to [0, MAX_SIM_DELTA]
 * @param collision the course the player moves through
 * @param events    mutated in place with the edges this step produced
 */
export const stepPlayer = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  delta: number,
  collision: WorldCollision,
  events: SimEvents,
): void => {
  events.jumpStarted = false;
  events.landed = false;
  events.sprintStarted = false;

  const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_SIM_DELTA) : 0;
  if (dt === 0) return;

  // ONE instant for the whole step, including every substep.
  collision.setTime(params.time);

  const wasGrounded = motion.grounded;

  applySprint(motion, input, params, dt, events);
  applyJump(motion, input, params, events);
  applyHorizontal(motion, input, params, dt);
  motion.vy -= MOVEMENT.gravity * dt;

  // SUBSTEPPING: subdivided until no substep travels further than
  // `maxSubstepDistance`, so collision is as reliable at a sprint as a walk.
  const travel = Math.hypot(motion.vx, motion.vy, motion.vz) * dt;
  const substeps = Math.max(
    1,
    Math.min(Math.ceil(travel / MOVEMENT.maxSubstepDistance), MOVEMENT.maxSubsteps),
  );
  const sub = dt / substeps;

  for (let i = 0; i < substeps; i += 1) {
    integrate(motion, sub, collision);
  }

  if (motion.grounded) motion.coyote = COYOTE_TIME;
  else motion.coyote = Math.max(0, motion.coyote - dt);

  // LAUNCH PADS, applied after the substeps from the settled position. A SET,
  // not an add, so every player leaves a pad at the same speed.
  if (motion.grounded) {
    const pad = surfaceAt(motion.x, motion.z);
    if (pad && pad.boost > 0) {
      motion.vy = pad.boost;
      motion.grounded = false;
      motion.coyote = 0;
      motion.jumpCount += 1;
      events.jumpStarted = true;
    }
  }

  motion.treadmill = motion.grounded ? treadmillAt(motion.x, motion.y, motion.z) : 0;

  if (!wasGrounded && motion.grounded) events.landed = true;
};

/**
 * THE SPRINT: drain while held, refill while released, lock when dry.
 *
 * The bar drains whenever the key is held and the power is answering - on the
 * ground or in the air, moving or not, because the bar is what the player
 * reads and a bar that only drained sometimes would be a bar they could not
 * predict. It refills after a short rest, quickly.
 */
const applySprint = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  dt: number,
  events: SimEvents,
): void => {
  const max = SPRINT.maxEnergy;
  const wasSprinting = motion.sprinting;

  if (input.sprint && !motion.sprintLocked && motion.sprintEnergy > 0) {
    motion.sprinting = true;
    motion.sprintRest = 0;
    motion.sprintEnergy -= sprintDrainPerSecond(params.sprintCapacity) * dt;
    if (motion.sprintEnergy <= 0) {
      motion.sprintEnergy = 0;
      motion.sprinting = false;
      motion.sprintLocked = true;
    }
  } else {
    motion.sprinting = false;
    /*
     * THE BAR REFILLS WHEN Q IS RELEASED, and only then.
     *
     * A player who holds the key down after the bar has run dry is asking for
     * a power that is not there, and the bar waits for them to let go - the
     * alternative was a bar that refilled under a held key, sprinted for half
     * a second, ran dry again and flickered on and off at the bottom for as
     * long as the key was down. Release, breathe, sprint: that is the rhythm.
     */
    if (input.sprint) {
      motion.sprintRest = 0;
    } else {
      motion.sprintRest = Math.min(motion.sprintRest + dt, 10);
      if (motion.sprintRest >= SPRINT.regenDelay && motion.sprintEnergy < max) {
        motion.sprintEnergy = Math.min(max, motion.sprintEnergy + SPRINT.regenPerSecond * dt);
      }
      if (motion.sprintLocked && motion.sprintEnergy >= SPRINT.minToRestart) {
        motion.sprintLocked = false;
      }
    }
  }

  if (motion.sprinting && !wasSprinting) events.sprintStarted = true;
};

/** One substep: move, then resolve, one axis at a time. */
const integrate = (motion: PlayerMotion, dt: number, collision: WorldCollision): void => {
  const previousY = motion.y;

  motion.x += motion.vx * dt;
  const correctedX = collision.resolveAxis(0, motion.x, motion.z, motion.y);
  if (correctedX !== motion.x) {
    motion.x = correctedX;
    motion.vx = 0;
  }

  motion.z += motion.vz * dt;
  const correctedZ = collision.resolveAxis(2, motion.z, motion.x, motion.y);
  if (correctedZ !== motion.z) {
    motion.z = correctedZ;
    motion.vz = 0;
  }

  motion.y += motion.vy * dt;

  collision.clampToBounds(motion.x, motion.z, BOUNDS);
  motion.x = BOUNDS.x;
  motion.z = BOUNDS.z;

  resolveCeiling(motion, previousY, collision);
  resolveGround(motion, previousY, collision);
};

/** The jump: ONE impulse on the frame the key goes down, from the ground or coyote. */
const applyJump = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  events: SimEvents,
): void => {
  const pressed = input.jump && !motion.jumpLatched;
  motion.jumpLatched = input.jump;
  if (!pressed) return;
  if (!motion.grounded && motion.coyote <= 0) return;

  motion.vy = Math.max(motion.vy, params.jumpVelocity);
  motion.grounded = false;
  motion.coyote = 0;
  motion.jumpCount += 1;
  events.jumpStarted = true;
};

const applyHorizontal = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  dt: number,
): void => {
  const hasInput = input.moveX !== 0 || input.moveZ !== 0;

  // Rotate the raw stick into world space using the camera's yaw. The camera
  // looks along (sin, cos); its RIGHT is (-cos, sin).
  const sin = Math.sin(input.cameraYaw);
  const cos = Math.cos(input.cameraYaw);
  const dirX = input.moveZ * sin - input.moveX * cos;
  const dirZ = input.moveZ * cos + input.moveX * sin;

  // TWO gaits: the run, and the sprint on top of it.
  const boost = motion.sprinting ? SPRINT.boost : 1;
  const targetSpeed = MOVEMENT.moveSpeed * params.moveMultiplier * boost;
  const control = motion.grounded ? 1 : MOVEMENT.airControl;

  const surface = surfaceAt(motion.x, motion.z);
  const grip = surface && motion.grounded ? Math.max(0.05, surface.grip) : 1;

  // Wind acts in the AIR as well as on the ground.
  if (surface) {
    motion.vx += surface.windX * dt;
    motion.vz += surface.windZ * dt;
  }

  if (hasInput) {
    const accel =
      MOVEMENT.acceleration *
      params.moveMultiplier *
      (motion.sprinting ? SPRINT.accelerationBoost : 1) *
      control *
      grip *
      dt;
    const rate = Math.min(accel / targetSpeed, 1);
    motion.vx += (dirX * targetSpeed - motion.vx) * rate;
    motion.vz += (dirZ * targetSpeed - motion.vz) * rate;

    const desiredYaw = Math.atan2(dirX, dirZ);
    motion.yaw = rotateTowards(motion.yaw, desiredYaw, MOVEMENT.turnSpeed * dt);
  } else if (motion.grounded) {
    const drop = MOVEMENT.deceleration * params.moveMultiplier * grip * dt;
    const speed = horizontalSpeed(motion);
    if (speed <= drop || speed < 1e-6) {
      motion.vx = 0;
      motion.vz = 0;
    } else {
      const scale = (speed - drop) / speed;
      motion.vx *= scale;
      motion.vz *= scale;
    }
  }
};

const resolveCeiling = (
  motion: PlayerMotion,
  previousY: number,
  collision: WorldCollision,
): void => {
  if (motion.vy <= 0) return;

  const ceiling = collision.ceilingYAt(motion.x, motion.z, previousY + PLAYER_HEIGHT);
  if (ceiling === null) return;
  if (motion.y + PLAYER_HEIGHT <= ceiling) return;

  motion.y = ceiling - PLAYER_HEIGHT;
  motion.vy = 0;
};

const resolveGround = (
  motion: PlayerMotion,
  previousY: number,
  collision: WorldCollision,
): void => {
  const surfaceY = collision.surfaceYAt(motion.x, motion.z, previousY);

  if (surfaceY === null || motion.vy > 0 || motion.y > surfaceY) {
    motion.grounded = false;
    return;
  }

  if (!collision.canLandOn(previousY, surfaceY)) {
    motion.grounded = false;
    return;
  }

  motion.y = surfaceY;
  motion.vy = 0;
  motion.grounded = true;
};
