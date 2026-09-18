import type { Group } from 'three';
import {
  AIRBORNE,
  DEATH,
  IDLE,
  JUMP_ANIMATION,
  JUMP_START,
  LANDING,
  LOCOMOTION,
  TRANSITIONS,
} from '../config/animationConfig.js';
import type { AnimationInput } from './AnimationInput.js';
import { LocomotionCycle } from './LocomotionCycle.js';
import { PoseBuffer } from './PoseBuffer.js';
import type { PlayerRig } from './rig/PlayerRig.js';

export type AnimationState = 'idle' | 'run' | 'jumpStart' | 'airborne' | 'landing' | 'dying';

const JUMP_STATES: ReadonlySet<AnimationState> = new Set(['jumpStart', 'airborne', 'landing']);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The player animation state machine: idle, the locomotion cycle (walk, run
 * and sprint are one cycle at three depths), the jump's three beats, and the
 * fall-over.
 *
 * Writes ONLY to bones (via `PlayerRig`) and to the visual node's position
 * and rotation. It never touches the physics root.
 */
export class PlayerAnimator {
  private readonly locomotion = new LocomotionCycle();

  private readonly target = new PoseBuffer();
  private readonly from = new PoseBuffer();
  private readonly output = new PoseBuffer();

  private state: AnimationState = 'idle';
  private stateTime = 0;
  private blendTime = 0;
  private blendDuration = 0;
  private idleTime = 0;
  private wasGrounded = true;
  private airWeight = 1;
  /** Eased bank into a turn, in radians. */
  private bank = 0;

  constructor(
    private rig: PlayerRig,
    private readonly visual: Group,
  ) {}

  get currentState(): AnimationState {
    return this.state;
  }

  /** 0..1, how far into the sprint pose the body is. Drives the effect intensity. */
  get sprintBlend(): number {
    return this.locomotion.sprintBlend;
  }

  /** Drive a different body (a Bloxity avatar swap). */
  setRig(rig: PlayerRig): void {
    this.rig = rig;
  }

  reset(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.blendDuration = 0;
    this.wasGrounded = true;
    this.airWeight = 1;
    this.bank = 0;
    this.target.reset();
    this.from.reset();
    this.output.reset();
    this.rig.resetToBindPose();
    this.visual.position.set(0, 0, 0);
    this.visual.rotation.set(0, 0, 0);
  }

  update(delta: number, input: AnimationInput): void {
    const dt = Math.max(0, delta);
    const jumpDt = dt * JUMP_ANIMATION.playbackRate;
    this.stateTime += JUMP_STATES.has(this.state) ? jumpDt : dt;
    this.resolveState(input);
    this.writePose(dt, jumpDt, input);
    this.apply(JUMP_STATES.has(this.state) ? jumpDt : dt, dt, input);
  }

  private resolveState(input: AnimationInput): void {
    if (input.dying) {
      this.setState('dying', TRANSITIONS.toDeath);
      return;
    }
    if (this.state === 'dying') {
      this.setState('idle', TRANSITIONS.toLocomotion);
    }

    if (input.landed || (input.grounded && !this.wasGrounded)) {
      this.wasGrounded = true;
      this.setState('landing', TRANSITIONS.toLanding);
      return;
    }
    this.wasGrounded = input.grounded;

    if (input.jumpStarted) {
      this.airWeight = 1;
      this.setState('jumpStart', TRANSITIONS.toJumpStart);
      return;
    }

    if (!input.grounded) {
      if (this.state === 'jumpStart' && this.stateTime < JUMP_START.duration) return;
      this.setState('airborne', TRANSITIONS.toAirborne);
      return;
    }

    if (this.state === 'landing' && this.stateTime < LANDING.duration) return;
    this.setState(
      input.horizontalSpeed < LOCOMOTION.idleSpeed ? 'idle' : 'run',
      TRANSITIONS.toLocomotion,
    );
  }

  private setState(next: AnimationState, duration: number): void {
    if (next === this.state) return;
    this.from.copyFrom(this.output);
    this.state = next;
    this.stateTime = 0;
    this.blendTime = 0;
    this.blendDuration = duration;
  }

  private writePose(dt: number, jumpDt: number, input: AnimationInput): void {
    switch (this.state) {
      case 'idle': {
        this.locomotion.settleTowardNeutral(dt);
        this.idleTime += dt;
        const breath = Math.sin(this.idleTime * IDLE.breathFrequency * Math.PI * 2);
        this.target.applyDefinition(IDLE.basePose);
        this.target.add('Spine1', breath * IDLE.breathAmount);
        this.target.add('Neck1', -breath * IDLE.breathAmount * 0.6);
        this.target.bobY = breath * IDLE.breathBob;
        break;
      }
      case 'run':
        this.locomotion.advance(dt, input.horizontalSpeed, input.moveMultiplier, input.sprinting);
        this.locomotion.writePose(this.target, input.horizontalSpeed, input.moveMultiplier);
        break;
      case 'jumpStart':
        this.target.applyDefinition(JUMP_START.pose);
        this.target.bobY = JUMP_START.bobY;
        break;
      case 'airborne':
        this.writeAirborne(jumpDt, input.verticalVelocity);
        break;
      case 'landing': {
        const depth = 1 - ease(clamp(this.stateTime / LANDING.duration, 0, 1));
        this.target.applyDefinition(LANDING.pose, depth);
        this.target.bobY = LANDING.bobY * depth;
        break;
      }
      case 'dying':
        this.target.applyDefinition(DEATH.pose);
        this.target.bobY = 0;
        break;
    }
  }

  private writeAirborne(jumpDt: number, verticalVelocity: number): void {
    const t = clamp(verticalVelocity / AIRBORNE.velocityReference, -1, 1);
    const targetWeight = (t + 1) * 0.5;
    this.airWeight += (targetWeight - this.airWeight) * (1 - Math.exp(-JUMP_ANIMATION.airBlendRate * jumpDt));
    this.target.applyDefinition(AIRBORNE.fall, 1 - this.airWeight);
    this.target.blendInDefinition(AIRBORNE.rise, this.airWeight);
    this.target.bobY = 0;
  }

  private apply(blendDt: number, dt: number, input: AnimationInput): void {
    if (this.blendDuration > 0) {
      this.blendTime += blendDt;
      const t = clamp(this.blendTime / this.blendDuration, 0, 1);
      this.output.lerpBetween(this.from, this.target, ease(t));
      if (t >= 1) this.blendDuration = 0;
    } else {
      this.output.copyFrom(this.target);
    }

    this.rig.applyPose(this.output);

    // The bank: the whole body leans into a steer, harder at a sprint.
    const wantBank =
      this.state === 'run'
        ? -input.turn * LOCOMOTION.bankAngle * (0.6 + this.locomotion.sprintBlend * 0.8)
        : 0;
    this.bank += (wantBank - this.bank) * (1 - Math.exp(-LOCOMOTION.bankRate * dt));

    if (this.state === 'dying') {
      // The fall-over: the visual node keels sideways, pitches forward and
      // sinks, over the death hold. Rebuilt from the state time every frame.
      const t = ease(clamp(this.stateTime / DEATH.duration, 0, 1));
      this.visual.rotation.set(DEATH.pitch * t, 0, DEATH.roll * t);
      this.visual.position.y = -DEATH.drop * t;
      return;
    }

    this.visual.rotation.set(0, 0, this.bank);
    this.visual.position.y = this.output.bobY;
  }
}
