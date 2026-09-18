import {
  MOVEMENT,
  SPRINT,
  TREADMILLS,
  WorldCollision,
  copyMotion,
  createMotion,
  createSimEvents,
  horizontalSpeed,
  resetMotion,
  stepPlayer,
  type MoveMessage,
  type MovementInput,
  type PlayerMotion,
  type SimParams,
} from '@godspeed/shared';
import { Vector3 } from 'three';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import type { AnimationState } from '../animation/PlayerAnimator.js';
import { DEATH } from '../config/animationConfig.js';
import type { InputState } from '../input/InputState.js';
import { NamePlate } from './NamePlate.js';
import { PlayerCharacter } from './PlayerCharacter.js';

const MAX_PENDING_INPUTS = 240;
const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const ARRIVE_DURATION = 0.16;
const RESPAWN_ACK_TIMEOUT = 1.5;
const RESPAWN_NUDGE_INTERVAL = 0.75;
const SNAP_DISTANCE = 5;
const CORRECTION_RATE = 14;

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

const EMPTY_INPUTS: MoveMessage[] = [];

export type PlacementKind = 'none' | 'respawn' | 'correction';

interface PendingInput {
  seq: number;
  dt: number;
  input: MovementInput;
}

/**
 * The authoritative fields the client reconciles against.
 *
 * This must cover EVERY field of `PlayerMotion`, the sprint bar included:
 * replay re-runs `stepPlayer`, which drains and refills the bar, and a replay
 * from the client's own idea of the energy would derive different sprint
 * edges than the server did.
 */
export interface AuthoritativeMotion {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  grounded: boolean;
  jumpCount: number;
  lastInputSeq: number;
  jumpLatched: boolean;
  coyote: number;
  sprintEnergy: number;
  sprinting: boolean;
  sprintLocked: boolean;
  sprintRest: number;
}

/**
 * The locally controlled character: a PREDICTION of a server-owned simulation.
 *
 * Runs the identical `stepPlayer` from shared so the character responds
 * instantly, keeps every input the server has not acknowledged, and on each
 * server update snaps to the authoritative state and replays those inputs.
 */
export class LocalPlayer {
  readonly character: PlayerCharacter;
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  private readonly previous = { x: 0, y: 0, z: 0 };
  private readonly motion: PlayerMotion = createMotion();
  private readonly events = createSimEvents();
  private readonly replayEvents = createSimEvents();
  private readonly collision: WorldCollision;
  private readonly params: SimParams = {
    moveMultiplier: 1,
    jumpVelocity: MOVEMENT.jumpVelocity,
    sprintCapacity: 1,
    time: 0,
  };

  private readonly pending: PendingInput[] = [];
  private nextSeq = 1;
  private readonly outgoing: MoveMessage[] = [];
  private accumulator = 0;
  private readonly correction = new Vector3();
  private placement: PlacementKind = 'none';
  private deathTime = -1;
  private arriveTime = -1;
  private awaitingRespawn = false;
  private respawnWait = 0;
  private stuckTime = -1;
  private turnSignal = 0;
  private readonly animationInput: AnimationInput = createAnimationInput();
  private readonly plate = new NamePlate();
  /** True on the frame the sprint switched on, for the sound. */
  private sprintStartedEdge = false;

  constructor(collision: WorldCollision) {
    this.collision = collision;
    this.character = new PlayerCharacter();
    this.character.root.add(this.plate.sprite);
    this.previous.x = this.motion.x;
    this.previous.y = this.motion.y;
    this.previous.z = this.motion.z;
    this.syncFromMotion();
    this.syncCharacter();
  }

  get horizontalSpeed(): number {
    return horizontalSpeed(this.motion);
  }

  get rotationY(): number {
    return this.motion.yaw;
  }

  get isGrounded(): boolean {
    return this.motion.grounded;
  }

  get justLanded(): boolean {
    return this.events.landed;
  }

  get justJumped(): boolean {
    return this.events.jumpStarted;
  }

  get justSprinted(): boolean {
    return this.sprintStartedEdge;
  }

  get isSprinting(): boolean {
    return this.motion.sprinting;
  }

  /** The predicted sprint bar, 0..1. What the HUD draws between patches. */
  get sprintFraction(): number {
    return Math.min(Math.max(this.motion.sprintEnergy / SPRINT.maxEnergy, 0), 1);
  }

  get sprintLocked(): boolean {
    return this.motion.sprintLocked;
  }

  get animationState(): AnimationState {
    return this.character.animationState;
  }

  drainOutgoing(): MoveMessage[] {
    if (this.outgoing.length === 0) return EMPTY_INPUTS;
    const batch = this.outgoing.slice();
    this.outgoing.length = 0;
    return batch;
  }

  get movementMultiplier(): number {
    return this.params.moveMultiplier;
  }

  /** Actual run speed in world units per second, before the sprint. */
  get maxRunSpeed(): number {
    return MOVEMENT.moveSpeed * this.params.moveMultiplier;
  }

  /** Apply the server's movement profile. */
  setMovementProfile(multiplier: number, jumpVelocity: number, sprintCapacity: number): void {
    if (Number.isFinite(multiplier) && multiplier > 0) this.params.moveMultiplier = multiplier;
    if (Number.isFinite(jumpVelocity) && jumpVelocity > 0) this.params.jumpVelocity = jumpVelocity;
    if (Number.isFinite(sprintCapacity) && sprintCapacity > 0) this.params.sprintCapacity = sprintCapacity;
  }

  /** Show the cosmetics the server says this player wears. */
  setCosmetics(trailSlot: number, auraSlot: number, upgradeSlot: number): void {
    this.character.setCosmetics(trailSlot, auraSlot, upgradeSlot);
  }

  setDisplayName(displayName: string, avatarUrl: string): void {
    this.plate.set(displayName, avatarUrl, this.character.height);
  }

  setWorldTime(time: number): void {
    if (Number.isFinite(time)) this.params.time = time;
  }

  get onTreadmill(): boolean {
    return this.motion.treadmill > 0;
  }

  teleport(x: number, y: number, z: number, rotationY: number): void {
    resetMotion(this.motion, x, y, z, rotationY);
    this.previous.x = x;
    this.previous.y = y;
    this.previous.z = z;
    this.pending.length = 0;
    this.outgoing.length = 0;
    this.accumulator = 0;
    this.correction.set(0, 0, 0);
    this.placement = 'respawn';
    this.deathTime = -1;
    this.stuckTime = -1;
    this.arriveTime = 0;
    this.character.resetAnimation();
    this.character.setVisualScale(0.15);
    this.syncFromMotion();
    this.syncCharacter();
  }

  beginDeath(): void {
    if (this.deathTime >= 0) return;
    this.deathTime = 0;
    this.arriveTime = -1;
    this.awaitingRespawn = true;
    this.respawnWait = 0;
    this.stuckTime = -1;
    this.pending.length = 0;
    this.outgoing.length = 0;
    this.correction.set(0, 0, 0);
    this.accumulator = 0;
    this.motion.vx = 0;
    this.motion.vy = 0;
    this.motion.vz = 0;
    this.motion.sprinting = false;
  }

  get isDying(): boolean {
    return this.deathTime >= 0;
  }

  get deathComplete(): boolean {
    return this.deathTime >= DEATH.duration;
  }

  consumeRespawnNudge(): boolean {
    if (this.stuckTime < RESPAWN_NUDGE_INTERVAL) return false;
    this.stuckTime = 0;
    return true;
  }

  acknowledgeRespawn(): void {
    this.awaitingRespawn = false;
    this.respawnWait = 0;
  }

  reconcile(state: AuthoritativeMotion): void {
    if (this.awaitingRespawn) return;

    const predictedX = this.motion.x;
    const predictedY = this.motion.y;
    const predictedZ = this.motion.z;

    this.motion.x = state.x;
    this.motion.y = state.y;
    this.motion.z = state.z;
    this.motion.vx = state.velocityX;
    this.motion.vy = state.velocityY;
    this.motion.vz = state.velocityZ;
    this.motion.yaw = state.rotationY;
    this.motion.grounded = state.grounded;
    this.motion.jumpCount = state.jumpCount;
    this.motion.jumpLatched = state.jumpLatched;
    this.motion.coyote = state.coyote;
    this.motion.sprintEnergy = state.sprintEnergy;
    this.motion.sprinting = state.sprinting;
    this.motion.sprintLocked = state.sprintLocked;
    this.motion.sprintRest = state.sprintRest;

    let kept = 0;
    for (const entry of this.pending) {
      if (entry.seq <= state.lastInputSeq) continue;
      this.pending[kept] = entry;
      kept += 1;
    }
    this.pending.length = kept;

    for (const entry of this.pending) {
      stepPlayer(this.motion, entry.input, this.params, entry.dt, this.collision, this.replayEvents);
    }

    const dx = predictedX - this.motion.x;
    const dy = predictedY - this.motion.y;
    const dz = predictedZ - this.motion.z;
    const snapped = Math.hypot(dx, dy, dz) > SNAP_DISTANCE;
    this.correction.set(snapped ? 0 : dx, snapped ? 0 : dy, snapped ? 0 : dz);

    if (snapped) {
      this.previous.x = this.motion.x;
      this.previous.y = this.motion.y;
      this.previous.z = this.motion.z;
      if (this.placement === 'none') this.placement = 'correction';
    }

    this.syncFromMotion();
    this.syncCharacter();
  }

  update(delta: number, input: Readonly<InputState>, cameraYaw: number): void {
    this.tickRespawnBarrier(delta);
    this.sprintStartedEdge = false;

    if (this.deathTime >= 0) {
      this.deathTime += delta;
      if (this.deathTime >= DEATH.duration) {
        this.stuckTime = this.stuckTime < 0 ? 0 : this.stuckTime + delta;
      }
      this.emitIdleInputs(delta);
      this.updateAnimation(delta, true);
      this.character.updateEffects(delta, this.position.x, this.position.y, this.position.z, 0, false, 0);
      return;
    }

    this.accumulator += Math.max(0, delta);
    this.turnSignal = input.moveX;

    let steps = 0;
    let jumpStarted = false;
    let landed = false;
    let sprintStarted = false;

    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_DT;
      steps += 1;

      const movement: MovementInput = {
        moveX: input.moveX,
        moveZ: input.moveZ,
        jump: input.jump,
        sprint: input.sprint,
        cameraYaw,
      };

      const seq = this.nextSeq;
      this.nextSeq += 1;

      this.previous.x = this.motion.x;
      this.previous.y = this.motion.y;
      this.previous.z = this.motion.z;

      stepPlayer(this.motion, movement, this.params, FIXED_DT, this.collision, this.events);

      jumpStarted = jumpStarted || this.events.jumpStarted;
      landed = landed || this.events.landed;
      sprintStarted = sprintStarted || this.events.sprintStarted;

      this.pending.push({ seq, dt: FIXED_DT, input: movement });
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();

      this.outgoing.push({
        seq,
        dt: FIXED_DT,
        moveX: movement.moveX,
        moveZ: movement.moveZ,
        jump: movement.jump,
        sprint: movement.sprint,
        cameraYaw,
      });
    }

    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.events.jumpStarted = jumpStarted;
    this.events.landed = landed;
    this.sprintStartedEdge = sprintStarted;

    this.advanceArrival(delta);
    this.decayCorrection(delta);
    this.syncFromMotion();
    this.syncCharacter();
    this.updateAnimation(delta, false);

    // The trail and the wake are emitted from the RENDERED position. A player
    // on a treadmill lays neither: they are not going anywhere.
    const travel = this.onTreadmill ? 0 : this.horizontalSpeed;
    this.character.updateEffects(
      delta,
      this.position.x,
      this.position.y,
      this.position.z,
      travel,
      this.motion.sprinting,
      this.feetSpeed,
    );
  }

  consumePlacement(): PlacementKind {
    const kind = this.placement;
    this.placement = 'none';
    return kind;
  }

  readMotion(into: PlayerMotion): void {
    copyMotion(this.motion, into);
  }

  /** The speed the FEET move at: the belt's, on a treadmill. */
  private get feetSpeed(): number {
    return this.onTreadmill
      ? TREADMILLS.beltSpeed * this.params.moveMultiplier * (this.motion.sprinting ? SPRINT.boost : 1)
      : this.horizontalSpeed;
  }

  private advanceArrival(delta: number): void {
    if (this.arriveTime < 0) return;
    this.arriveTime += delta;
    const t = Math.min(this.arriveTime / ARRIVE_DURATION, 1);
    if (t >= 1) {
      this.arriveTime = -1;
      this.character.setVisualScale(1);
      return;
    }
    const scale = 0.15 + 0.85 * t * (2 - t) + 0.08 * Math.sin(t * Math.PI);
    this.character.setVisualScale(scale);
  }

  private emitIdleInputs(delta: number): void {
    this.accumulator += Math.max(0, delta);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_DT;
      steps += 1;
      this.outgoing.push({
        seq: this.nextSeq,
        dt: FIXED_DT,
        moveX: 0,
        moveZ: 0,
        jump: false,
        sprint: false,
        cameraYaw: this.motion.yaw,
      });
      this.nextSeq += 1;
    }
    if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;
  }

  private tickRespawnBarrier(delta: number): void {
    if (!this.awaitingRespawn) return;
    this.respawnWait += delta;
    if (this.respawnWait < RESPAWN_ACK_TIMEOUT) return;
    this.awaitingRespawn = false;
    this.respawnWait = 0;
  }

  private decayCorrection(delta: number): void {
    if (this.correction.lengthSq() < 1e-8) {
      this.correction.set(0, 0, 0);
      return;
    }
    this.correction.multiplyScalar(Math.exp(-CORRECTION_RATE * delta));
  }

  private syncFromMotion(): void {
    const alpha = Math.min(Math.max(this.accumulator / FIXED_DT, 0), 1);
    this.position.set(
      lerp(this.previous.x, this.motion.x, alpha) + this.correction.x,
      lerp(this.previous.y, this.motion.y, alpha) + this.correction.y,
      lerp(this.previous.z, this.motion.z, alpha) + this.correction.z,
    );
    this.velocity.set(this.motion.vx, this.motion.vy, this.motion.vz);
  }

  private updateAnimation(delta: number, dying: boolean): void {
    this.animationInput.grounded = this.motion.grounded;
    this.animationInput.horizontalSpeed = this.feetSpeed;
    this.animationInput.moveMultiplier = this.params.moveMultiplier;
    this.animationInput.verticalVelocity = this.motion.vy;
    this.animationInput.sprinting = !dying && this.motion.sprinting;
    this.animationInput.turn = dying ? 0 : this.turnSignal;
    this.animationInput.jumpStarted = !dying && this.events.jumpStarted;
    this.animationInput.landed = !dying && this.events.landed;
    this.animationInput.dying = dying;
    this.character.update(delta, this.animationInput);
  }

  private syncCharacter(): void {
    this.character.setPosition(this.position.x, this.position.y, this.position.z);
    this.character.setYaw(this.motion.yaw);
  }
}
