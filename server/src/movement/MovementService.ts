import {
  MAX_SIM_DELTA,
  WorldCollision,
  copyMotion,
  createMotion,
  createSimEvents,
  horizontalSpeed,
  resetMotion,
  sanitiseInput,
  stepPlayer,
  type MoveMessage,
  type PlayerMotion,
  type SimEvents,
} from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** Simulated seconds a client may bank per real second. */
const MAX_TIME_BUDGET_RATIO = 1.5;

/** Seconds of simulated time a fresh client starts with, to absorb bursts. */
const INITIAL_BUDGET = 0.5;

/** Largest jump in sequence number the server will follow. */
const MAX_SEQ_JUMP = 600;

export type RejectReason = 'malformed' | 'stale-seq' | 'seq-jump' | 'budget';

interface Sim {
  motion: PlayerMotion;
  events: SimEvents;
  lastSeq: number;
  budget: number;
  lastRefill: number;
}

/**
 * Server-authoritative movement.
 *
 * The client sends INPUT and nothing else; this runs the shared simulation and
 * the result becomes the player's position, velocity, rotation, grounded,
 * jump and SPRINT state. Because the very same `stepPlayer` runs on the client
 * for prediction, the two agree by construction rather than by trust.
 */
export class MovementService {
  private readonly sims = new Map<string, Sim>();
  readonly collision = new WorldCollision();

  private lastReject: RejectReason | null = null;
  private lastStepSeconds = 0;
  /** Where the last accepted step started, so Speed can measure it. */
  private lastFromX = 0;
  private lastFromZ = 0;
  private lastWasGrounded = true;

  initialise(player: PlayerState): void {
    const sim: Sim = {
      motion: createMotion(),
      events: createSimEvents(),
      lastSeq: 0,
      budget: INITIAL_BUDGET,
      lastRefill: Date.now(),
    };
    this.sims.set(player.sessionId, sim);
    this.publish(player, sim);
  }

  /** True while this session has a live simulation. */
  has(sessionId: string): boolean {
    return this.sims.has(sessionId);
  }

  forget(sessionId: string): void {
    this.sims.delete(sessionId);
  }

  motionOf(sessionId: string): PlayerMotion | undefined {
    return this.sims.get(sessionId)?.motion;
  }

  get rejectReason(): RejectReason | null {
    return this.lastReject;
  }

  /** Seconds the last accepted input advanced the simulation. */
  get lastStep(): number {
    return this.lastStepSeconds;
  }

  /** Horizontal distance the last accepted step actually covered. */
  lastDistance(player: PlayerState): number {
    return Math.hypot(player.x - this.lastFromX, player.z - this.lastFromZ);
  }

  /** True when the last step began AND ended on the ground: a real stride. */
  lastStepOnGround(player: PlayerState): boolean {
    return this.lastWasGrounded && player.grounded;
  }

  /** Teleport authoritatively, e.g. on respawn. Only the server calls this. */
  teleport(
    sessionId: string,
    player: PlayerState,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void {
    const sim = this.sims.get(sessionId);
    if (!sim) return;
    resetMotion(sim.motion, x, y, z, yaw);
    this.publish(player, sim);
  }

  /**
   * Consume one input and advance the authoritative simulation.
   *
   * @returns true when the input was simulated
   */
  applyInput(sessionId: string, player: PlayerState, message: MoveMessage, time: number): boolean {
    this.lastReject = null;
    const sim = this.sims.get(sessionId);
    if (!sim) return false;

    const seq = message?.seq;
    const dt = message?.dt;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) {
      this.lastReject = 'malformed';
      return false;
    }
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
      this.lastReject = 'malformed';
      return false;
    }
    if (seq <= sim.lastSeq) {
      this.lastReject = 'stale-seq';
      return false;
    }
    if (seq > sim.lastSeq + MAX_SEQ_JUMP) {
      this.lastReject = 'seq-jump';
      return false;
    }

    const step = Math.min(dt, MAX_SIM_DELTA);
    this.refill(sim);
    if (step > sim.budget) {
      this.lastReject = 'budget';
      return false;
    }
    sim.budget -= step;
    sim.lastSeq = seq;
    this.lastStepSeconds = step;
    this.lastFromX = sim.motion.x;
    this.lastFromZ = sim.motion.z;
    this.lastWasGrounded = sim.motion.grounded;

    const input = sanitiseInput(message);

    stepPlayer(
      sim.motion,
      input,
      {
        moveMultiplier: player.moveMultiplier,
        jumpVelocity: player.jumpVelocity,
        sprintCapacity: player.sprintCapacity,
        time,
      },
      step,
      this.collision,
      sim.events,
    );

    this.publish(player, sim);
    return true;
  }

  /** Copy the simulation onto the replicated state. */
  private publish(player: PlayerState, sim: Sim): void {
    const m = sim.motion;
    player.x = m.x;
    player.y = m.y;
    player.z = m.z;
    player.rotationY = m.yaw;
    player.velocityX = m.vx;
    player.velocityY = m.vy;
    player.velocityZ = m.vz;
    player.verticalVelocity = m.vy;
    player.speed = horizontalSpeed(m);
    player.grounded = m.grounded;
    player.jumpCount = m.jumpCount;
    player.jumpLatched = m.jumpLatched;
    player.coyote = m.coyote;
    player.treadmill = m.treadmill;
    player.sprintEnergy = m.sprintEnergy;
    player.sprinting = m.sprinting;
    player.sprintLocked = m.sprintLocked;
    player.sprintRest = m.sprintRest;
    player.lastInputSeq = sim.lastSeq;
    player.ready = true;
  }

  private refill(sim: Sim): void {
    const now = Date.now();
    const elapsed = Math.max(0, (now - sim.lastRefill) / 1000);
    sim.lastRefill = now;
    sim.budget = Math.min(sim.budget + elapsed * MAX_TIME_BUDGET_RATIO, MAX_SIM_DELTA * 20);
  }

  snapshot(sessionId: string, into: PlayerMotion): boolean {
    const sim = this.sims.get(sessionId);
    if (!sim) return false;
    copyMotion(sim.motion, into);
    return true;
  }
}
