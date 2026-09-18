import { Schema, type } from '@colyseus/schema';
import { AvatarState } from './AvatarState.js';
import {
  PlayerAnimationState,
  INITIAL_OWNED_TRAILS,
  INITIAL_OWNED_UPGRADES,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  SPRINT,
  STARTER_UPGRADE_SLOT,
  type PlayerAnimationState as AnimationState,
} from '@godspeed/shared';

/**
 * Replicated per-player state.
 *
 * Every field here is written by the SERVER. Transform and motion come out of
 * the authoritative simulation; progression, Wins and every inventory are
 * written only by their own service. Nothing is ever copied from a client
 * message.
 */
export class PlayerState extends Schema {
  @type('string') sessionId = '';

  @type('float32') x: number = SPAWN_POSITION.x;
  @type('float32') y: number = SPAWN_POSITION.y;
  @type('float32') z: number = SPAWN_POSITION.z;
  @type('float32') rotationY: number = SPAWN_ROTATION_Y;

  /** Horizontal speed, drives the remote gait blend. */
  @type('float32') speed = 0;
  @type('float32') verticalVelocity = 0;
  @type('boolean') grounded = true;

  /** Authoritative velocity, needed by the client to reconcile prediction. */
  @type('float32') velocityX = 0;
  @type('float32') velocityY = 0;
  @type('float32') velocityZ = 0;
  /** Highest input sequence the server has simulated for this player. */
  @type('uint32') lastInputSeq = 0;

  /**
   * LATCHED simulation state, replicated so client reconciliation can restore
   * the FULL authoritative motion before it replays unacknowledged input.
   */
  @type('boolean') jumpLatched = false;
  @type('float32') coyote = 0;

  /**
   * THE SPRINT BAR, and the two latches around it.
   *
   * Replicated for two reasons: the HUD draws the bar from it, and the client
   * replays pending input from it - a replay that started from its own idea
   * of the energy would derive different sprint edges than the server did.
   */
  @type('float32') sprintEnergy = SPRINT.maxEnergy;
  @type('boolean') sprinting = false;
  @type('boolean') sprintLocked = false;
  @type('float32') sprintRest = 1;

  @type('uint32') jumpCount = 0;
  @type('uint32') deathCount = 0;

  /** Treadmill the player is standing on, or 0. Derived by the simulation. */
  @type('uint8') treadmill = 0;

  @type('string') animation: AnimationState = PlayerAnimationState.Idle;

  /** How this player looks in the Bloxity portal. Cosmetic; sanitised. */
  @type(AvatarState) avatar = new AvatarState();

  /** THE NAME EVERYONE SEES, and the portrait beside it. */
  @type('string') displayName = '';
  @type('string') avatarUrl = '';

  /** Server-authoritative progression. */
  @type('uint32') level = 1;
  @type('uint32') rebirths = 0;
  /**
   * Wins. `float64`, because the unlock ladders run to trillions and a uint32
   * wraps at four billion. Written through `Wallet` only.
   */
  @type('float64') wins = 0;
  /** Lifetime farmed Speed. Awarded by SpeedService only. Drives level. */
  @type('float64') totalSpeed = 0;

  /** Equipped speed upgrade - the best one owned. Written by UpgradeService. */
  @type('uint8') upgradeSlot = STARTER_UPGRADE_SLOT;
  @type('uint16') ownedUpgrades = INITIAL_OWNED_UPGRADES;

  /** Speed granted per STEP, resolved by the one shared formula. */
  @type('float64') speedPerStep = 1;

  /** Authoritative movement multiplier and jump velocity. */
  @type('float32') moveMultiplier = 1;
  @type('float32') jumpVelocity = 26;

  /** Highest stage (1-based) ever banked. */
  @type('uint32') bestStage = 0;

  /** Trails. Written ONLY by TrailService. */
  @type('uint32') ownedTrails = INITIAL_OWNED_TRAILS;
  @type('uint8') trailSlot = 1;

  /** Auras. Written ONLY by AuraService. */
  @type('uint8') ownedAuras = 0;
  @type('uint8') auraSlot = 0;

  /** Charms. Written ONLY by CharmService. */
  @type('uint32') ownedCharms = 0;
  @type('uint32') equippedCharms = 0;
  /** Sprint capacity multiplier from charms. The client predicts with it. */
  @type('float32') sprintCapacity = 1;

  /** Seconds played, lifetime. The Top Time board. */
  @type('float64') playSeconds = 0;

  /** True once the server has simulated at least one input for this player. */
  @type('boolean') ready = false;
}
