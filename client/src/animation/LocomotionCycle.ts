import { LOCOMOTION } from '../config/animationConfig.js';
import type { PoseBuffer } from './PoseBuffer.js';

const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A pose parameter at three depths. */
interface Depth {
  readonly walk: number;
  readonly run: number;
  readonly sprint: number;
}

/**
 * One procedural walk/run/sprint cycle driven by a phase.
 *
 * Walk, run and sprint are the SAME cycle: two blends, derived from actual
 * movement speed, raise the cadence and strengthen the pose, so the character
 * flows from a stroll into a run and from a run into a flat-out sprint rather
 * than snapping between canned animations. The sprint blend is ALSO pushed by
 * the sprint flag, so the moment the god power lands the body leans into it
 * before the speed has fully arrived.
 *
 * Phase advances with distance travelled, not with wall-clock time, so the
 * feet stay planted in step with real movement at any speed.
 */
export class LocomotionCycle {
  private phase = 0;
  /** Eased sprint weight, so the lean arrives rather than snapping. */
  private sprintWeight = 0;

  get currentPhase(): number {
    return this.phase;
  }

  /** How strongly the run pose is applied, 0..1. */
  runBlend(speed: number, multiplier: number): number {
    const scale = Math.max(1, multiplier);
    return smoothstep(LOCOMOTION.walkSpeed * scale, LOCOMOTION.runSpeed * scale, speed);
  }

  /** How strongly the sprint pose is applied, 0..1. */
  get sprintBlend(): number {
    return this.sprintWeight;
  }

  /** Advance the cycle. Returns the frequency used, in cycles per second. */
  advance(delta: number, speed: number, multiplier: number, sprinting: boolean): number {
    const scale = Math.max(1, multiplier);
    const frequency = clamp(
      speed / LOCOMOTION.strideDistance,
      LOCOMOTION.minFrequency,
      LOCOMOTION.maxFrequency,
    );
    this.phase = (this.phase + frequency * TAU * delta) % TAU;

    const bySpeed = smoothstep(LOCOMOTION.runSpeed * scale, LOCOMOTION.sprintSpeed * scale, speed);
    const target = sprinting ? Math.max(0.6, bySpeed) : bySpeed * 0.4;
    this.sprintWeight += (target - this.sprintWeight) * (1 - Math.exp(-7 * delta));
    return frequency;
  }

  /** Ease the cycle back toward a neutral standing phase. */
  settleTowardNeutral(delta: number): void {
    const target = this.phase > Math.PI ? TAU : 0;
    const alpha = 1 - Math.exp(-8 * delta);
    this.phase += (target - this.phase) * alpha;
    if (this.phase >= TAU - 1e-4) this.phase = 0;
    this.sprintWeight *= Math.exp(-6 * delta);
  }

  /** Write the locomotion pose for the current phase. */
  writePose(out: PoseBuffer, speed: number, multiplier: number): void {
    const run = this.runBlend(speed, multiplier);
    const sprint = this.sprintWeight;
    const phase = this.phase;

    const depth = (d: Depth): number => lerp(lerp(d.walk, d.run, run), d.sprint, sprint);

    const hip = depth(LOCOMOTION.hipSwing);
    const knee = depth(LOCOMOTION.kneeBend);
    const arm = depth(LOCOMOTION.armSwing);
    const elbow = depth(LOCOMOTION.elbowBend);
    const twist = depth(LOCOMOTION.torsoTwist);
    const lean = depth(LOCOMOTION.torsoLean);
    const headTwist = depth(LOCOMOTION.headCounterTwist);
    const roll = depth(LOCOMOTION.torsoRoll);
    const bob = depth(LOCOMOTION.bob);

    const swing = Math.sin(phase);
    const oppositeSwing = -swing;

    out.reset();

    // Thighs: a half cycle apart, so the feet alternate. At a sprint the
    // stride is pushed BACK more than forward, which is what a sprinter does.
    const back = 1 + sprint * 0.35;
    out.set('LegL1', hip * (swing > 0 ? swing : swing * back));
    out.set('LegR1', hip * (oppositeSwing > 0 ? oppositeSwing : oppositeSwing * back));

    // Knees bend during the swing-through only.
    out.set('LegL2', knee * kneeCurve(phase));
    out.set('LegR2', knee * kneeCurve(phase + Math.PI));

    // Arms counter-swing against the leg on the same side, and at a sprint
    // they pump: elbows tight, hands high.
    out.set('ArmL1', arm * oppositeSwing - sprint * 0.25, 0, sprint * 0.12);
    out.set('ArmR1', arm * swing - sprint * 0.25, 0, -sprint * 0.12);
    out.set('ArmL2', elbow + elbow * 0.35 * Math.max(0, oppositeSwing));
    out.set('ArmR2', elbow + elbow * 0.35 * Math.max(0, swing));

    // The torso leans in, twists with the stride and rolls on the footfall.
    out.set('Spine1', lean, twist * oppositeSwing, roll * Math.sin(phase * 2));
    out.set('Spine2', lean * 0.4, twist * 0.5 * oppositeSwing, 0);
    // The head looks UP the course however far the body leans.
    out.set('Neck1', -lean * 0.7, headTwist * swing, 0);

    out.bobY = -bob * Math.cos(phase * 2);
  }
}

/** Knee flexion over one cycle: zero while planted, peaking as the foot lifts. */
const kneeCurve = (phase: number): number => {
  const raw = Math.sin(phase - Math.PI / 2.6);
  return raw > 0 ? raw * raw : 0;
};
