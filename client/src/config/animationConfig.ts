import { DEATH_HOLD_SECONDS } from '@godspeed/shared';
import type { PoseDefinition } from '../animation/PoseBuffer.js';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Procedural animation tuning.
 *
 * Data-driven on purpose: every number the animator uses lives here, so the
 * character can be re-tuned without touching a line of logic. All rotations
 * are in CHARACTER space (see `PlayerRig`).
 */

/** The walk/run/sprint cycle. ONE cycle, three depths. */
export const LOCOMOTION = {
  /** Cycle frequency clamp, in cycles per second. */
  minFrequency: 0.7,
  maxFrequency: 3.4,
  /** World units between two footfalls at a run. */
  strideDistance: 5.2,
  /** Below this speed the character is standing still. */
  idleSpeed: 0.6,
  /** Speed at which the WALK pose is fully in, before the multiplier. */
  walkSpeed: 4,
  /** Speed at which the RUN pose is fully in, before the multiplier. */
  runSpeed: 15,
  /** Speed at which the SPRINT pose is fully in, before the multiplier. */
  sprintSpeed: 27,

  hipSwing: { walk: deg(22), run: deg(40), sprint: deg(58) },
  kneeBend: { walk: deg(30), run: deg(58), sprint: deg(74) },
  armSwing: { walk: deg(18), run: deg(38), sprint: deg(60) },
  elbowBend: { walk: deg(14), run: deg(46), sprint: deg(74) },
  torsoTwist: { walk: deg(4), run: deg(7), sprint: deg(9) },
  /** Forward lean of the spine. A sprinter leans INTO it. */
  torsoLean: { walk: deg(3), run: deg(11), sprint: deg(24) },
  headCounterTwist: { walk: deg(2), run: deg(4), sprint: deg(5) },
  torsoRoll: { walk: deg(2), run: deg(3), sprint: deg(3) },
  /** Vertical bob, in world units, twice per cycle. */
  bob: { walk: 0.05, run: 0.11, sprint: 0.16 },
  /** How far the whole body banks into a turn. */
  bankAngle: deg(9),
  bankRate: 8,
} as const;

/** The idle: breathing, and nothing else. */
export const IDLE = {
  breathFrequency: 0.35,
  breathAmount: deg(1.8),
  breathBob: 0.012,
  basePose: {
    ArmL1: { x: deg(4), z: deg(6) },
    ArmR1: { x: deg(4), z: deg(-6) },
    ArmL2: { x: deg(10) },
    ArmR2: { x: deg(10) },
  } satisfies PoseDefinition,
} as const;

/** The push-off: a brief crouch and arm throw as the feet leave the ground. */
export const JUMP_START = {
  duration: 0.1,
  pose: {
    LegL1: { x: deg(-30) },
    LegR1: { x: deg(-30) },
    LegL2: { x: deg(46) },
    LegR2: { x: deg(46) },
    ArmL1: { x: deg(-70), z: deg(14) },
    ArmR1: { x: deg(-70), z: deg(-14) },
    Spine1: { x: deg(8) },
  } satisfies PoseDefinition,
  bobY: -0.18,
} as const;

/** In the air: a rising pose and a falling pose, blended by vertical velocity. */
export const AIRBORNE = {
  velocityReference: 14,
  rise: {
    LegL1: { x: deg(-42) },
    LegR1: { x: deg(12) },
    LegL2: { x: deg(66) },
    LegR2: { x: deg(24) },
    ArmL1: { x: deg(-120), z: deg(22) },
    ArmR1: { x: deg(-120), z: deg(-22) },
    ArmL2: { x: deg(20) },
    ArmR2: { x: deg(20) },
    Spine1: { x: deg(-6) },
    Neck1: { x: deg(-8) },
  } satisfies PoseDefinition,
  fall: {
    LegL1: { x: deg(14) },
    LegR1: { x: deg(-8) },
    LegL2: { x: deg(30) },
    LegR2: { x: deg(20) },
    ArmL1: { x: deg(-40), z: deg(48) },
    ArmR1: { x: deg(-40), z: deg(-48) },
    ArmL2: { x: deg(30) },
    ArmR2: { x: deg(30) },
    Spine1: { x: deg(10) },
    Neck1: { x: deg(6) },
  } satisfies PoseDefinition,
} as const;

/** The landing crouch. Short: a runner lands and keeps going. */
export const LANDING = {
  duration: 0.16,
  pose: {
    LegL1: { x: deg(-34) },
    LegR1: { x: deg(-34) },
    LegL2: { x: deg(58) },
    LegR2: { x: deg(58) },
    ArmL1: { x: deg(-18), z: deg(20) },
    ArmR1: { x: deg(-18), z: deg(-20) },
    Spine1: { x: deg(14) },
  } satisfies PoseDefinition,
  bobY: -0.32,
} as const;

/** The jump's playback rate, so the arc reads rather than snaps. Visual only. */
export const JUMP_ANIMATION = {
  playbackRate: 0.8,
  airBlendRate: 9,
} as const;

/** The fall-over. Readable, brief, and deliberately not gruesome. */
export const DEATH = {
  /** THE SERVER'S NUMBER. See `DEATH_HOLD_SECONDS`. */
  duration: DEATH_HOLD_SECONDS,
  /** How far the body keels over sideways, in radians. */
  roll: deg(88),
  /** How far it pitches forward as it goes. */
  pitch: deg(18),
  /** How far the body sinks. */
  drop: 0.9,
  pose: {
    ArmL1: { x: deg(-80), z: deg(30) },
    ArmR1: { x: deg(-80), z: deg(-30) },
    LegL1: { x: deg(-20) },
    LegR1: { x: deg(10) },
    Spine1: { x: deg(10) },
    Neck1: { x: deg(-12) },
  } satisfies PoseDefinition,
} as const;

/** Seconds a pose change takes to blend in. */
export const TRANSITIONS = {
  toLocomotion: 0.14,
  toJumpStart: 0.05,
  toAirborne: 0.16,
  toLanding: 0.06,
  toDeath: 0.12,
} as const;
