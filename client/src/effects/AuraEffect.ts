import { auraBySlot, type AuraStyle } from '@godspeed/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  RingGeometry,
} from 'three';
import { createPointsMaterial } from './pointsMaterial.js';

/** Motes orbiting the player. Fixed, so an aura's cost is known. */
const MOTES = 48;

interface StyleTuning {
  /** Orbit radius, and how tall the column of motes is. */
  readonly radius: number;
  readonly height: number;
  /** Turns per second. */
  readonly spin: number;
  readonly size: number;
  /** How many of the motes are drawn. Lower tiers are sparser. */
  readonly share: number;
  /** Ground disc opacity. */
  readonly disc: number;
  /** Wings: motes are bunched into two arcs behind the shoulders. */
  readonly wings: boolean;
  /** Crown: a second small ring over the head. */
  readonly crown: boolean;
  /** Nova: the ring breathes in and out. */
  readonly breathe: number;
}

const STYLES: Readonly<Record<AuraStyle, StyleTuning>> = {
  ring: { radius: 1.4, height: 0.6, spin: 0.5, size: 1.1, share: 0.5, disc: 0.28, wings: false, crown: false, breathe: 0 },
  wings: { radius: 1.6, height: 2.2, spin: 0.15, size: 1.3, share: 0.8, disc: 0.3, wings: true, crown: false, breathe: 0 },
  storm: { radius: 1.8, height: 3.2, spin: 1.1, size: 1.2, share: 0.9, disc: 0.34, wings: false, crown: false, breathe: 0.15 },
  crown: { radius: 1.5, height: 2.6, spin: 0.6, size: 1.3, share: 0.8, disc: 0.36, wings: false, crown: true, breathe: 0 },
  nova: { radius: 2.0, height: 3.4, spin: 0.9, size: 1.6, share: 1, disc: 0.4, wings: true, crown: true, breathe: 0.45 },
  divine: { radius: 2.3, height: 3.8, spin: 0.7, size: 1.8, share: 1, disc: 0.45, wings: true, crown: true, breathe: 0.3 },
};

/**
 * THE AURA: a ring of divine light that visibly surrounds the player.
 *
 * Parented to the character's root so it follows for free, and cheap on
 * purpose: it is drawn for EVERY visible player, aura-wearers being the
 * veterans who are always in the room. Forty-eight motes on one `Points`
 * mesh, a ground disc and (on the crowned tiers) a small ring overhead. Motes
 * are placed by a formula of time rather than simulated, so the per-frame
 * cost is a loop of sines and one upload.
 */
export class AuraEffect {
  readonly root = new Group();

  private readonly geometry = new BufferGeometry();
  private readonly positions = new Float32Array(MOTES * 3);
  private readonly colors = new Float32Array(MOTES * 3);
  private readonly sizes = new Float32Array(MOTES);
  private readonly lives = new Float32Array(MOTES);
  private readonly points: Points;
  private readonly material = createPointsMaterial(true);

  private readonly discMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  private readonly discGeometry = new RingGeometry(0.4, 1.9, 32);
  private readonly disc: Mesh;
  private readonly crownGeometry = new RingGeometry(0.5, 0.68, 24);
  private readonly crown: Mesh;

  private slot = 0;
  private tuning: StyleTuning = STYLES.ring;
  private time = 0;
  private readonly color = new Color();

  constructor() {
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aLife', new BufferAttribute(this.lives, 1));
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;

    this.disc = new Mesh(this.discGeometry, this.discMaterial);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.06;
    this.crown = new Mesh(this.crownGeometry, this.discMaterial);
    this.crown.rotation.x = -Math.PI / 2;

    this.root.add(this.points, this.disc, this.crown);
    this.root.visible = false;
  }

  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    const tier = auraBySlot(slot);
    this.root.visible = tier !== undefined;
    if (!tier) return;
    this.tuning = STYLES[tier.style];
    this.color.setHex(tier.color);
    this.discMaterial.color.setHex(tier.color);
    this.discMaterial.opacity = this.tuning.disc;
    this.crown.visible = this.tuning.crown;
    for (let i = 0; i < MOTES; i += 1) {
      const at = i * 3;
      const bright = i % 3 === 0 ? 1.25 : 1;
      this.colors[at] = Math.min(1, this.color.r * bright);
      this.colors[at + 1] = Math.min(1, this.color.g * bright);
      this.colors[at + 2] = Math.min(1, this.color.b * bright);
      this.sizes[i] = this.tuning.size * (0.7 + (i % 5) * 0.12);
      this.lives[i] = i < MOTES * this.tuning.share ? 0.9 : 0;
    }
    (this.geometry.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLife') as BufferAttribute).needsUpdate = true;
  }

  /** @param yaw the character's facing, so wings sit behind the shoulders. */
  update(delta: number, yaw: number): void {
    if (!this.root.visible) return;
    this.time += Math.max(0, delta);
    const t = this.tuning;
    const breathe = 1 + t.breathe * Math.sin(this.time * 2.2);
    const radius = t.radius * breathe;
    const count = Math.floor(MOTES * t.share);

    for (let i = 0; i < count; i += 1) {
      const k = i / count;
      let angle: number;
      let height: number;
      if (t.wings) {
        // Two arcs behind the shoulders, sweeping up and out.
        const wing = i % 2 === 0 ? 1 : -1;
        const along = (i % (count / 2)) / (count / 2);
        angle = -yaw + Math.PI + wing * (0.35 + along * 1.1);
        height = 1.4 + along * t.height * 0.5 + Math.sin(this.time * 3 + i) * 0.08;
      } else {
        angle = k * Math.PI * 2 + this.time * t.spin * Math.PI * 2;
        // A helix: motes climb as they orbit, then wrap.
        height = ((k * 3 + this.time * 0.35) % 1) * t.height + 0.3;
      }
      const at = i * 3;
      const r = radius * (t.wings ? 0.7 + (i % 4) * 0.12 : 1);
      this.positions[at] = Math.cos(angle) * r;
      this.positions[at + 1] = height;
      this.positions[at + 2] = Math.sin(angle) * r;
    }
    this.geometry.setDrawRange(0, count);
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;

    this.disc.rotation.z = this.time * 0.8;
    this.disc.scale.setScalar(radius / 1.6);
    if (t.crown) {
      this.crown.position.y = 3.7 + Math.sin(this.time * 2.5) * 0.06;
      this.crown.rotation.z = -this.time * 1.4;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.discGeometry.dispose();
    this.discMaterial.dispose();
    this.crownGeometry.dispose();
    this.root.removeFromParent();
  }
}
