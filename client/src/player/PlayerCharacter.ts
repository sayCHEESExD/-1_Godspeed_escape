import { PLAYER_HEIGHT } from '@godspeed/shared';
import { Group, Mesh, Object3D } from 'three';
import type { AnimationInput } from '../animation/AnimationInput.js';
import { PlayerAnimator, type AnimationState } from '../animation/PlayerAnimator.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { PLAYER_MODEL_YAW_OFFSET } from '../config/worldVisuals.js';
import { AuraEffect } from '../effects/AuraEffect.js';
import { GodPowerEffect } from '../effects/GodPowerEffect.js';
import { playerModelLoader } from './PlayerModelLoader.js';
import { TrailEffect } from './TrailEffect.js';

/**
 * The visual half of a player, arranged so animation can never move them.
 *
 *   root          physics transform (position + facing). Gameplay owns it.
 *     visual      the bob, the bank, the fall-over and the arrival pop
 *       model     the cloned FBX (or a Bloxity body), posed by the rig
 *     aura        the ring of light, in the character's own space
 *   worldRoot     the trail and the god power, which live in WORLD space
 *                 because they describe where the player has BEEN
 */
export class PlayerCharacter {
  readonly root = new Group();
  readonly worldRoot = new Group();
  readonly trail = new TrailEffect();
  readonly aura = new AuraEffect();
  readonly power = new GodPowerEffect();

  private readonly visual = new Group();
  private readonly defaultModel: Object3D;
  private model: Object3D;
  private animator: PlayerAnimator;
  private rig: PlayerRig;

  constructor() {
    this.defaultModel = playerModelLoader.createInstance();
    this.model = this.defaultModel;
    this.model.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    this.root.add(this.visual, this.aura.root);
    this.visual.add(this.model);
    this.rig = new PlayerRig(this.model, this.model);
    this.animator = new PlayerAnimator(this.rig, this.visual);
    this.worldRoot.add(this.trail.root, this.power.root);
  }

  /** The body currently worn: the bundled FBX or a Bloxity body. */
  get modelRoot(): Object3D {
    return this.model;
  }

  /** The visual node and the model, for the cosmetics layer. */
  get body(): { visual: Group; model: Object3D } {
    return { visual: this.visual, model: this.model };
  }

  /** Height of the whole silhouette, for floating labels. */
  get height(): number {
    return PLAYER_HEIGHT;
  }

  /**
   * Wear a different body, or null for the bundled one.
   *
   * The body goes into the SAME `visual` node, so nothing above it moves, and
   * a fresh rig is bound to it by bone name - Bloxity's `player.glb` carries
   * the twelve names `player.fbx` does, so the run and the jump drive it
   * unchanged.
   */
  setModel(next: Object3D | null): Object3D {
    const target = next ?? this.defaultModel;
    if (target === this.model) return target;

    const previous = this.model;
    previous.removeFromParent();
    releaseBody(previous);

    target.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    this.rig = new PlayerRig(target, target);
    this.rig.resetToBindPose();
    target.updateMatrixWorld(true);

    this.model = target;
    this.visual.add(target);
    this.animator.setRig(this.rig);
    return target;
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  /** Scale the body, for the arrival pop. Never the physics root. */
  setVisualScale(scale: number): void {
    this.visual.scale.setScalar(scale);
  }

  setCosmetics(trailSlot: number, auraSlot: number, upgradeSlot: number): void {
    this.trail.setSlot(trailSlot);
    this.aura.setSlot(auraSlot);
    this.power.setSlot(upgradeSlot);
  }

  update(delta: number, input: AnimationInput): void {
    this.animator.update(Math.max(0, delta), input);
    this.aura.update(delta, this.root.rotation.y);
  }

  /**
   * Advance the world-space effects.
   *
   * @param speed the speed the feet are moving at (the belt's, on a treadmill)
   * @param travel the speed the player is actually covering ground at
   */
  updateEffects(
    delta: number,
    x: number,
    y: number,
    z: number,
    travel: number,
    sprinting: boolean,
    speed: number,
  ): void {
    this.trail.update(delta, x, y, z, travel);
    this.power.update(delta, x, y, z, this.root.rotation.y, sprinting, speed);
  }

  get animationState(): AnimationState {
    return this.animator.currentState;
  }

  get sprintBlend(): number {
    return this.animator.sprintBlend;
  }

  resetAnimation(): void {
    this.animator.reset();
    this.visual.scale.setScalar(1);
    this.trail.clear();
    this.power.clear();
  }

  dispose(): void {
    this.trail.dispose();
    this.aura.dispose();
    this.power.dispose();
    this.root.removeFromParent();
    this.worldRoot.removeFromParent();
  }
}

/**
 * Let go of a body that has been swapped out.
 *
 * ONLY its material, and only when the body was one built for a Bloxity
 * avatar. Geometry is left alone: part meshes are cached and shared between
 * every player wearing the same item.
 */
const releaseBody = (model: Object3D): void => {
  if (model.userData['bloxityBody'] !== true) return;
  model.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
};
