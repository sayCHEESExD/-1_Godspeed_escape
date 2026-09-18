import {
  MAX_SIM_DELTA,
  SPEED,
  TREADMILLS,
  charmBonuses,
  describeSpeedRate,
  resolveLevel,
  resolveMovementProfile,
  speedForNextLevel,
  speedPerStepFor,
  type MovementProfile,
  type SpeedRateInputs,
} from '@godspeed/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';

const SCOPE = 'speed';

/** What the server remembers between two simulated steps for one player. */
interface Tracker {
  /** Distance banked toward the next STEP. */
  banked: number;
  /** True until the first step is credited, so spawning pays nothing. */
  fresh: boolean;
  /** The last rate logged, so the log shows changes and not every tick. */
  loggedRate: number;
}

export interface SpeedGain {
  readonly gained: number;
  readonly levelsGained: number;
}

/**
 * Server authority over Speed farming and levelling.
 *
 * THE ONE PLACE SPEED IS EVER GRANTED, and it grants it for exactly one thing:
 * STEPS. Every `SPEED.strideDistance` of ground actually covered pays the
 * player's rate, resolved by the one shared formula. A treadmill supplies the
 * distance instead, at the belt's speed, so a player standing on one takes
 * steps without moving.
 *
 * What the server measures is its OWN simulated step - the distance between
 * two authoritative positions - never a figure a client chose. Standing still
 * pays nothing, a teleport pays nothing, and a jump pays nothing: the feet
 * have to be on the ground for a stride to be a stride.
 */
export class SpeedService {
  private readonly trackers = new Map<string, Tracker>();

  initialise(player: PlayerState): void {
    player.level = 1;
    this.syncDerived(player);
    this.reset(player.sessionId);
  }

  forget(sessionId: string): void {
    this.trackers.delete(sessionId);
  }

  /** Drop the stride baseline. Called on every respawn. */
  reset(sessionId: string): void {
    const existing = this.trackers.get(sessionId);
    this.trackers.set(sessionId, {
      banked: 0,
      fresh: true,
      loggedRate: existing?.loggedRate ?? -1,
    });
  }

  /**
   * Credit one simulated step and apply any level-ups.
   *
   * @param stepSeconds  seconds the step covered
   * @param distance     horizontal distance the authoritative position moved
   * @param onGround     true when the step began and ended grounded
   */
  credit(
    sessionId: string,
    player: PlayerState,
    stepSeconds: number,
    distance: number,
    onGround: boolean,
  ): SpeedGain {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) {
      this.reset(sessionId);
      return { gained: 0, levelsGained: 0 };
    }

    const step = Number.isFinite(stepSeconds)
      ? Math.max(0, Math.min(stepSeconds, MAX_SIM_DELTA))
      : 0;

    const rate = this.rateOf(player);
    if (rate !== tracker.loggedRate) {
      tracker.loggedRate = rate;
      logger.info(SCOPE, `${sessionId} rate: ${describeSpeedRate(this.rateInputs(player))}`);
    }

    /*
     * THE DISTANCE THAT COUNTS.
     *
     * On a belt, the belt's own travel: the player covers no ground by design.
     * Otherwise the ground actually covered this step - if it was on the
     * ground, if it was possible (anything beyond what the player's own
     * authoritative speed could cover is a teleport), and if it was not the
     * first step after a placement.
     */
    let travelled = 0;
    if (!tracker.fresh && step > 0) {
      if (player.treadmill > 0) {
        travelled = TREADMILLS.beltSpeed * step;
      } else if (onGround && distance <= this.maxCreditedStep(player, step)) {
        travelled = distance >= SPEED.movingSpeed * step ? distance : 0;
      }
    }

    // THE PAYMENT, in whole steps. The remainder stays banked.
    let gained = 0;
    if (travelled > 0) {
      tracker.banked += travelled;
      while (tracker.banked + 1e-9 >= SPEED.strideDistance) {
        tracker.banked -= SPEED.strideDistance;
        gained += rate;
      }
    }
    tracker.fresh = false;

    const beforeLevel = player.level;
    if (gained > 0) player.totalSpeed += gained;
    this.syncDerived(player);

    return { gained, levelsGained: player.level - beforeLevel };
  }

  /**
   * Re-derive level and everything downstream from the current Speed total.
   *
   * Used on join, on reconnect and whenever an inventory changes.
   */
  syncDerived(player: PlayerState): void {
    player.level = resolveLevel(player.totalSpeed).level;
    player.speedPerStep = this.rateOf(player);
    player.sprintCapacity = charmBonuses(player.equippedCharms, player.ownedCharms).sprint;

    const profile = this.movementProfile(player);
    player.moveMultiplier = profile.multiplier;
    player.jumpVelocity = profile.jumpVelocity;
  }

  /** THE player's movement profile, through the one shared evaluator. */
  movementProfile(player: PlayerState): MovementProfile {
    return resolveMovementProfile(player.level, player.rebirths);
  }

  speedToNextLevel(player: PlayerState): number {
    return speedForNextLevel(player.level);
  }

  private rateInputs(player: PlayerState): SpeedRateInputs {
    return {
      upgradeSlot: player.upgradeSlot,
      trailSlot: player.trailSlot,
      ownedTrails: player.ownedTrails,
      auraSlot: player.auraSlot,
      ownedAuras: player.ownedAuras,
      equippedCharms: player.equippedCharms,
      ownedCharms: player.ownedCharms,
      rebirths: player.rebirths,
    };
  }

  private rateOf(player: PlayerState): number {
    return speedPerStepFor(this.rateInputs(player));
  }

  /**
   * Largest movement the server will credit from one simulated step: the
   * player's own SPRINT speed times the step, with slack.
   */
  private maxCreditedStep(player: PlayerState, stepSeconds: number): number {
    const step = Number.isFinite(stepSeconds)
      ? Math.max(0, Math.min(stepSeconds, MAX_SIM_DELTA))
      : MAX_SIM_DELTA;
    // Wind can push a player faster than they run, so the cap is generous.
    return this.movementProfile(player).moveSpeed * 2.2 * step * SPEED.creditSlack + 0.5;
  }
}
