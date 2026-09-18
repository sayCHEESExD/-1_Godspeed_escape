import { NO_TRAIL, trailBySlot, type TrailStyle } from '@godspeed/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
} from 'three';

const SEGMENTS = 30;
/** How far the player must travel before a new segment is laid. */
const STEP = 0.7;
const HALF_WIDTH = 0.55;
/** Height above the feet the ribbon is emitted at: the hips. */
const EMIT_Y = 1.15;
/** Seconds a segment lives. */
const FADE_SECONDS = 0.6;

/** The warm tip the fiery styles flicker toward. */
const FIRE_TIP = new Color(0xfff0a0);

/**
 * The colour of one segment of a trail, by STYLE.
 *
 * The single place a trail's look is defined: the ribbon behind the player
 * and the backpack's previews both call it, so the two never disagree. Fire
 * flickers from its base toward a pale tip, lightning strobes white, holy
 * pulses, cosmic drifts through violet, rainbow cycles hue.
 */
export const tintTrail = (
  style: TrailStyle,
  base: Color,
  index: number,
  count: number,
  time: number,
  out: Color,
): Color => {
  switch (style) {
    case 'rainbow':
      out.setHSL(((index / count) * 0.8 + time * 0.35) % 1, 0.95, 0.55);
      break;
    case 'void':
      out.setHex(index % 5 === 0 ? 0x8f7bff : base.getHex());
      break;
    case 'fire':
      out.copy(base).lerp(FIRE_TIP, Math.abs(Math.sin(time * 12 + index)) * 0.5);
      break;
    case 'lightning':
      out.setHex(Math.floor(time * 20 + index) % 3 === 0 ? 0xffffff : base.getHex());
      break;
    case 'holy':
      out.copy(base).offsetHSL(0, 0, Math.sin(time * 2 + index) * 0.1);
      break;
    case 'cosmic':
      out.setHSL((0.7 + Math.sin(time * 1.6 + index * 0.35) * 0.12 + 1) % 1, 0.9, 0.62);
      break;
    case 'energy':
      out.copy(base).offsetHSL(0, 0, Math.sin(time * 6 + index * 0.6) * 0.12);
      break;
    default:
      out.copy(base);
      break;
  }
  return out;
};

interface Sample {
  x: number;
  y: number;
  z: number;
  life: number;
}

/**
 * The ribbon a trail leaves behind the player, in WORLD space.
 *
 * One geometry and one material rewritten in place each frame: one draw call,
 * no per-particle objects. The STYLE decides the colour treatment - fire
 * flickers orange to yellow, lightning strobes white, holy pulses, cosmic
 * shifts hue - so nineteen trails are nineteen tints of one mesh.
 */
export class TrailEffect {
  readonly root = new Group();

  private readonly geometry = new BufferGeometry();
  private readonly material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    fog: false,
  });
  private readonly mesh: Mesh;
  private readonly positions = new Float32Array(SEGMENTS * 6);
  private readonly colors = new Float32Array(SEGMENTS * 6);
  private readonly samples: Sample[] = [];

  private slot = NO_TRAIL;
  private style: TrailStyle = 'solid';
  private readonly baseColor = new Color();
  private readonly scratch = new Color();
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private seeded = false;
  private time = 0;

  constructor() {
    for (let i = 0; i < SEGMENTS; i += 1) this.samples.push({ x: 0, y: 0, z: 0, life: 0 });
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(indices);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.root.add(this.mesh);
  }

  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    const tier = trailBySlot(slot);
    if (!tier) {
      this.clear();
      return;
    }
    this.style = tier.style;
    this.baseColor.setHex(tier.color);
    // Dark cannot glow additively, so the void trail draws normally.
    this.material.blending = this.style === 'void' ? NormalBlending : AdditiveBlending;
  }

  update(delta: number, x: number, y: number, z: number, speed: number): void {
    if (this.slot === NO_TRAIL) return;
    this.time += delta;
    if (!this.seeded) {
      this.lastX = x;
      this.lastY = y;
      this.lastZ = z;
      this.seeded = true;
    }

    const travelled = Math.hypot(x - this.lastX, y - this.lastY, z - this.lastZ);
    if (speed > 1.5 && travelled >= STEP) {
      this.push(x, y + EMIT_Y, z);
      this.lastX = x;
      this.lastY = y;
      this.lastZ = z;
    }

    const decay = delta / FADE_SECONDS;
    let alive = 0;
    for (const sample of this.samples) {
      if (sample.life <= 0) continue;
      sample.life -= decay;
      if (sample.life > 0) alive += 1;
    }
    this.mesh.visible = alive > 1;
    if (this.mesh.visible) this.writeGeometry();
  }

  clear(): void {
    for (const sample of this.samples) sample.life = 0;
    this.seeded = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }

  private push(x: number, y: number, z: number): void {
    for (let i = this.samples.length - 1; i > 0; i -= 1) {
      Object.assign(this.samples[i] as Sample, this.samples[i - 1] as Sample);
    }
    Object.assign(this.samples[0] as Sample, { x, y, z, life: 1 });
  }

  private writeGeometry(): void {
    const count = this.samples.length;
    for (let i = 0; i < count; i += 1) {
      const sample = this.samples[i] as Sample;
      const life = Math.max(0, sample.life);
      // Widened ACROSS the direction of travel, so it lies as a band.
      const previous = this.samples[Math.max(0, i - 1)] as Sample;
      const next = this.samples[Math.min(count - 1, i + 1)] as Sample;
      let dx = next.x - previous.x;
      let dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      const width = HALF_WIDTH * life * (this.style === 'fire' ? 1.3 : 1);
      const nx = -dz * width;
      const nz = dx * width;
      // A flicker of height on the fiery styles, so the ribbon licks.
      const lick =
        this.style === 'fire' || this.style === 'lightning'
          ? Math.sin(this.time * 18 + i * 1.7) * 0.18 * life
          : 0;
      const base = i * 6;
      this.positions[base] = sample.x + nx;
      this.positions[base + 1] = sample.y + lick;
      this.positions[base + 2] = sample.z + nz;
      this.positions[base + 3] = sample.x - nx;
      this.positions[base + 4] = sample.y - lick;
      this.positions[base + 5] = sample.z - nz;
      this.tint(i, life);
      for (let v = 0; v < 2; v += 1) {
        this.colors[base + v * 3] = this.scratch.r;
        this.colors[base + v * 3 + 1] = this.scratch.g;
        this.colors[base + v * 3 + 2] = this.scratch.b;
      }
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  private tint(index: number, life: number): void {
    tintTrail(this.style, this.baseColor, index, SEGMENTS, this.time, this.scratch);
    this.scratch.multiplyScalar(this.style === 'void' ? 1 : life);
  }
}
