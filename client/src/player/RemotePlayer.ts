import { MOVEMENT, SPRINT, TREADMILLS } from '@godspeed/shared';
import { DEATH } from '../config/animationConfig.js';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import type { NetPlayerState } from '../net/netTypes.js';
import { AvatarDresser } from '../bloxity/AvatarDresser.js';
import { lookFromState } from '../bloxity/avatarLook.js';
import { NamePlate } from './NamePlate.js';
import { PlayerCharacter } from './PlayerCharacter.js';

const FOLLOW_RATE = 14;
const SNAP_DISTANCE = 12;

const shortestAngle = (from: number, to: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

/**
 * Another player's character.
 *
 * Rendered from replicated state ONLY. Its animation is reconstructed locally
 * by the very same animator the local player runs, driven from the handful of
 * motion fields on the wire. Remotes are ghosted: they do not collide, and
 * they render completely normally.
 */
export class RemotePlayer {
  readonly character: PlayerCharacter;

  private readonly plate = new NamePlate();
  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private targetYaw = 0;
  private readonly input: AnimationInput = createAnimationInput();
  private lastDeathCount = -1;
  private deathTime = -1;
  private placed = false;
  private onTreadmill = false;
  private sprinting = false;
  private travelSpeed = 0;
  private readonly dresser: AvatarDresser;
  private lastLook = '';

  get position(): { readonly x: number; readonly y: number; readonly z: number } {
    return { x: this.targetX, y: this.targetY, z: this.targetZ };
  }

  constructor(state: NetPlayerState) {
    this.character = new PlayerCharacter();
    this.character.root.add(this.plate.sprite);
    this.dresser = new AvatarDresser(this.character);
    this.apply(state);
    this.character.setPosition(this.targetX, this.targetY, this.targetZ);
    this.character.setYaw(this.targetYaw);
    this.placed = true;
    this.lastDeathCount = state.deathCount;
  }

  /** Copy the replicated fields in. Called on every patch for this player. */
  apply(state: NetPlayerState): void {
    this.targetX = state.x;
    this.targetY = state.y;
    this.targetZ = state.z;
    this.targetYaw = state.rotationY;

    this.plate.set(state.displayName, state.avatarUrl, this.character.height);

    this.onTreadmill = state.treadmill > 0;
    this.sprinting = state.sprinting;
    this.travelSpeed = state.speed;
    this.input.grounded = state.grounded;
    const boost = state.sprinting ? SPRINT.boost : 1;
    // A remote on a treadmill reports zero velocity, so the run cycle is fed
    // the speed they are running AT.
    this.input.horizontalSpeed = this.onTreadmill
      ? TREADMILLS.beltSpeed * state.moveMultiplier * boost
      : state.speed;
    this.input.moveMultiplier = state.moveMultiplier || 1;
    this.input.verticalVelocity = state.verticalVelocity;
    this.input.sprinting = state.sprinting;

    this.character.setCosmetics(state.trailSlot, state.auraSlot, state.upgradeSlot);
    this.dressFrom(state);

    if (this.lastDeathCount >= 0 && state.deathCount > this.lastDeathCount) this.deathTime = 0;
    this.lastDeathCount = state.deathCount;
  }

  /** How much of the sprint effect this remote may run. See `RemotePlayerManager`. */
  setEffectBudget(budget: number): void {
    this.character.power.setBudget(budget);
  }

  private dressFrom(state: NetPlayerState): void {
    const avatar = state.avatar;
    if (!avatar) return;
    const look = lookFromState(avatar);
    const key = JSON.stringify(look);
    if (key === this.lastLook) return;
    this.lastLook = key;
    this.dresser.setLook(look.appearance, look.proportions);
  }

  update(delta: number): void {
    const dt = Math.max(0, delta);
    const position = this.character.root.position;
    const gap = Math.hypot(this.targetX - position.x, this.targetY - position.y, this.targetZ - position.z);

    if (!this.placed || gap > SNAP_DISTANCE) {
      position.set(this.targetX, this.targetY, this.targetZ);
      this.character.setYaw(this.targetYaw);
      this.placed = true;
      this.character.power.clear();
      this.character.trail.clear();
    } else {
      const alpha = 1 - Math.exp(-FOLLOW_RATE * dt);
      position.x += (this.targetX - position.x) * alpha;
      position.y += (this.targetY - position.y) * alpha;
      position.z += (this.targetZ - position.z) * alpha;
      const yaw = this.character.root.rotation.y;
      this.character.setYaw(yaw + shortestAngle(yaw, this.targetYaw) * alpha);
    }

    if (this.deathTime >= 0) {
      this.deathTime += dt;
      if (this.deathTime > DEATH.duration) this.deathTime = -1;
    }
    this.input.dying = this.deathTime >= 0;

    this.character.update(dt, this.input);
    this.character.updateEffects(
      dt,
      position.x,
      position.y,
      position.z,
      this.onTreadmill ? 0 : this.travelSpeed,
      this.sprinting && !this.input.dying,
      this.input.horizontalSpeed || MOVEMENT.moveSpeed,
    );
  }

  dispose(): void {
    this.plate.dispose();
    this.dresser.dispose();
    this.character.dispose();
  }
}
