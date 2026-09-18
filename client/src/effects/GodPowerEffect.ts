import { upgradeForSlot, type GodPower, type PowerStyle } from '@godspeed/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { ParticlePool } from './ParticlePool.js';

/** Most particles one player's power may hold. The budget scales the RATE. */
const POOL_SIZE = 220;

/** Most lightning bolts alive at once, and points per bolt. */
const MAX_BOLTS = 6;
export const BOLT_POINTS = 7;

/** Seconds between two re-drawn bolt sets: lightning flickers, it does not glide. */
export const BOLT_REFRESH = 0.055;

/** How the effect behaves for one style. Presentation only. */
export interface StyleTuning {
  /** Particles a second at full budget and intensity 1. */
  readonly rate: number;
  /** Particle speed backward along the wake. */
  readonly speed: number;
  readonly spread: number;
  readonly rise: number;
  readonly gravity: number;
  readonly size: number;
  readonly life: number;
  /** Bolts per refresh at intensity 1 (fractional = chance). */
  readonly bolts: number;
  /** Whether a vertical beam stands behind the runner. */
  readonly beam: boolean;
  /** Whether a halo ring hangs over the head. */
  readonly halo: boolean;
  /** How much the ground ring pulses. */
  readonly ring: number;
  /** Fraction of particles that take the accent colour. */
  readonly accentShare: number;
}

/**
 * THE ONE TABLE of what each power style looks like.
 *
 * The sprint effect reads it, and so do the previews standing on the speed
 * upgrade tiles: a tile shows exactly the power its tier unleashes because
 * both draw from this row, through the same emitters below.
 */
export const STYLES: Readonly<Record<PowerStyle, StyleTuning>> = {
  glow: { rate: 90, speed: 6, spread: 1.2, rise: 2.6, gravity: -1, size: 1.6, life: 0.7, bolts: 0, beam: false, halo: false, ring: 0.6, accentShare: 0.3 },
  beam: { rate: 110, speed: 8, spread: 0.9, rise: 5, gravity: 0, size: 1.5, life: 0.75, bolts: 0, beam: true, halo: false, ring: 0.8, accentShare: 0.4 },
  arc: { rate: 120, speed: 10, spread: 1.6, rise: 1.2, gravity: 4, size: 1.1, life: 0.45, bolts: 1.4, beam: false, halo: false, ring: 0.9, accentShare: 0.5 },
  lightning: { rate: 130, speed: 12, spread: 1.6, rise: 2, gravity: 6, size: 1.3, life: 0.5, bolts: 2.6, beam: false, halo: false, ring: 1, accentShare: 0.5 },
  flame: { rate: 190, speed: 9, spread: 1.4, rise: 5.5, gravity: -4, size: 2.2, life: 0.8, bolts: 0, beam: false, halo: false, ring: 0.7, accentShare: 0.45 },
  laser: { rate: 150, speed: 26, spread: 0.5, rise: 0.4, gravity: 0, size: 1.0, life: 0.6, bolts: 0.6, beam: false, halo: false, ring: 0.9, accentShare: 0.6 },
  storm: { rate: 200, speed: 11, spread: 2.4, rise: 3, gravity: 2, size: 1.9, life: 0.8, bolts: 3.2, beam: false, halo: false, ring: 1.1, accentShare: 0.3 },
  burst: { rate: 210, speed: 14, spread: 2.6, rise: 2, gravity: 3, size: 1.8, life: 0.55, bolts: 0.8, beam: false, halo: false, ring: 1.4, accentShare: 0.5 },
  halo: { rate: 150, speed: 7, spread: 1.4, rise: 6, gravity: -2, size: 1.7, life: 0.9, bolts: 0.5, beam: true, halo: true, ring: 1.0, accentShare: 0.5 },
  cosmic: { rate: 240, speed: 13, spread: 2.8, rise: 3.5, gravity: 0, size: 1.6, life: 1.0, bolts: 2, beam: true, halo: true, ring: 1.3, accentShare: 0.6 },
};

/** Geometry the sprint effect and the tile previews share the shape of. */
export const POWER_SHAPES = {
  ring: { inner: 0.9, outer: 2.1, segments: 28 },
  beam: { top: 0.5, bottom: 1.3, height: 9, segments: 10, lift: 4.5, setBack: 1.4 },
  halo: { inner: 0.75, outer: 1.05, segments: 26, lift: 3.75 },
} as const;

/**
 * Spawn `count` wake particles streaming back from the feet at (x, y, z),
 * facing (fx, fz). `scale` shrinks the whole thing for a preview; at 1 it is
 * the sprint effect exactly.
 */
export const spawnWake = (
  pool: ParticlePool,
  power: GodPower,
  t: StyleTuning,
  count: number,
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
  intensity: number,
  speed: number,
  scale = 1,
): void => {
  const drift = Math.min(speed, 40) * 0.25;
  const rx = -fz;
  const rz = fx;
  const tall = power.style === 'flame' || power.style === 'halo' ? 1.6 : 0.9;
  for (let i = 0; i < count; i += 1) {
    const side = (Math.random() - 0.5) * 2;
    const back = Math.random() * 0.8 * scale;
    const px = x - fx * back + rx * side * t.spread * 0.5 * scale;
    const pz = z - fz * back + rz * side * t.spread * 0.5 * scale;
    const py = y + (0.15 + Math.random() * tall) * scale;
    const vx = (-fx * (t.speed + drift) * (0.5 + Math.random()) + rx * side * t.spread * 2) * scale;
    const vz = (-fz * (t.speed + drift) * (0.5 + Math.random()) + rz * side * t.spread * 2) * scale;
    const vy = t.rise * (0.4 + Math.random() * 0.9) * scale;
    const accent = Math.random() < t.accentShare;
    const size = t.size * (0.7 + Math.random() * 0.8) * (0.8 + intensity * 0.4) * scale;
    pool.spawn(
      px,
      py,
      pz,
      vx,
      vy,
      vz,
      accent ? power.accent : power.color,
      size,
      t.life * (0.6 + Math.random() * 0.8),
      t.gravity * scale,
      1.6,
    );
  }
};

/**
 * Write ONE forked bolt into a line-segment position buffer, from above the
 * head down to the ground behind the runner, dropping glow points into the
 * pool at its joints and a strike where it lands. Returns the next free
 * float index. `scale` shrinks it for a preview.
 */
export const writeBolt = (
  positions: Float32Array,
  vertex: number,
  pool: ParticlePool,
  power: GodPower,
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
  strength: number,
  intensity: number,
  scale = 1,
): number => {
  const rx = -fz;
  const rz = fx;
  const side = (Math.random() - 0.5) * 3.2 * scale;
  const back = (0.8 + Math.random() * 2.6) * scale;
  const topX = x - fx * back + rx * side;
  const topZ = z - fz * back + rz * side;
  const topY = y + (3.5 + Math.random() * 3 * intensity) * scale;
  let px = topX;
  let py = topY;
  let pz = topZ;
  for (let s = 1; s < BOLT_POINTS; s += 1) {
    const k = s / (BOLT_POINTS - 1);
    const nx = topX + (Math.random() - 0.5) * 1.4 * scale;
    const nz = topZ + (Math.random() - 0.5) * 1.4 * scale;
    const ny = topY - (topY - y) * k;
    positions[vertex++] = px;
    positions[vertex++] = py;
    positions[vertex++] = pz;
    positions[vertex++] = nx;
    positions[vertex++] = ny;
    positions[vertex++] = nz;
    // A glow point on every joint, so the thin line reads as a bolt.
    if (s % 2 === 0) {
      pool.spawn(nx, ny, nz, 0, 0.5 * scale, 0, power.accent, 2.4 * strength * scale, 0.14, 0, 0);
    }
    px = nx;
    py = ny;
    pz = nz;
  }
  // The strike: a bright burst on the ground where it lands.
  pool.spawn(px, py + 0.1 * scale, pz, 0, 1.5 * scale, 0, power.color, 4 * strength * scale, 0.2, 0, 0);
  return vertex;
};

/**
 * THE GOD POWER: what a player unleashes while sprinting.
 *
 * Not a cosmetic trail. While the sprint runs, the equipped speed tier's
 * power is drawn AROUND and BEHIND the player: a wake of divine particles
 * streaming back from the feet, forked lightning striking down behind each
 * stride, a beam of light standing in the wake on the holier tiers, a halo
 * overhead on the highest, and a ring of energy pulsing on the ground under
 * the runner. It ramps in over a few frames when the power lands and dies
 * away when the bar runs dry.
 *
 * Every unlocked tier feels more powerful than the last through ONE knob:
 * `power.intensity` scales the particle rate, the bolt count, the size and
 * the glow. The BUDGET is the other knob, and it belongs to the room: the
 * local player and the nearest remotes run at 1, everyone else at a fraction,
 * so fifteen sprinters cannot each cost a full rig on every client.
 *
 * Lives in WORLD space: the wake is where the player HAS BEEN.
 */
export class GodPowerEffect {
  readonly root = new Group();

  private readonly pool = new ParticlePool(POOL_SIZE);
  /** The bolt CORES: thin bright lines. The bolts' glow is points from the pool. */
  private readonly boltGeometry = new BufferGeometry();
  private readonly boltPositions = new Float32Array(MAX_BOLTS * (BOLT_POINTS - 1) * 2 * 3);
  private readonly boltMaterial = new LineBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  private readonly bolts: LineSegments;

  /** The ground ring under the feet. Follows the player; not part of the wake. */
  private readonly ringMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  private readonly ring: Mesh;
  private readonly ringGeometry = new RingGeometry(POWER_SHAPES.ring.inner, POWER_SHAPES.ring.outer, POWER_SHAPES.ring.segments);

  /** The beam and the halo: a column and a ring of light, on the higher tiers. */
  private readonly beamMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  private readonly beam: Mesh;
  private readonly beamGeometry = new CylinderGeometry(
    POWER_SHAPES.beam.top,
    POWER_SHAPES.beam.bottom,
    POWER_SHAPES.beam.height,
    POWER_SHAPES.beam.segments,
    1,
    true,
  );
  private readonly halo: Mesh;
  private readonly haloGeometry = new RingGeometry(POWER_SHAPES.halo.inner, POWER_SHAPES.halo.outer, POWER_SHAPES.halo.segments);

  private slot = 0;
  private power: GodPower = upgradeForSlot(1).power;
  private tuning: StyleTuning = STYLES.glow;
  /** 0..1, how far the power is IN. Ramps toward the sprint flag. */
  private charge = 0;
  private budget = 1;
  private time = 0;
  private spawnDebt = 0;
  private boltTimer = 0;
  private readonly color = new Color();
  private readonly accent = new Color();

  constructor() {
    this.boltGeometry.setAttribute('position', new BufferAttribute(this.boltPositions, 3));
    this.boltGeometry.setDrawRange(0, 0);
    this.bolts = new LineSegments(this.boltGeometry, this.boltMaterial);
    this.bolts.frustumCulled = false;
    this.bolts.visible = false;

    this.ring = new Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;

    this.beam = new Mesh(this.beamGeometry, this.beamMaterial);
    this.beam.visible = false;
    this.halo = new Mesh(this.haloGeometry, this.beamMaterial);
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.visible = false;

    this.root.add(this.pool.points, this.bolts, this.ring, this.beam, this.halo);
    this.setSlot(1);
  }

  /** Wear the power of this speed tier. */
  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    this.power = upgradeForSlot(slot).power;
    this.tuning = STYLES[this.power.style];
    this.color.setHex(this.power.color);
    this.accent.setHex(this.power.accent);
    this.boltMaterial.color.setHex(this.power.accent);
    this.ringMaterial.color.setHex(this.power.color);
    this.beamMaterial.color.setHex(this.power.color);
  }

  /** 0..1: how much of the effect this player is allowed. See the class note. */
  setBudget(budget: number): void {
    this.budget = Math.min(Math.max(budget, 0), 1);
  }

  /** True while anything is still drawn, so an idle player costs one test. */
  get isVisible(): boolean {
    return this.charge > 0.01 || this.pool.liveCount > 0;
  }

  /**
   * @param x, y, z  the player's feet, in world space
   * @param yaw      which way they face
   * @param sprinting true while the power runs
   * @param speed     horizontal speed, so the wake stretches with it
   */
  update(
    delta: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    sprinting: boolean,
    speed: number,
  ): void {
    const dt = Math.max(0, delta);
    this.time += dt;

    // Ramps in fast and out a little slower: the power ARRIVES.
    const want = sprinting ? 1 : 0;
    this.charge += (want - this.charge) * (1 - Math.exp(-(sprinting ? 14 : 6) * dt));
    if (this.charge < 0.005) this.charge = 0;

    const intensity = this.power.intensity;
    const strength = this.charge * this.budget;

    // The wake is BEHIND the player: -forward.
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    if (strength > 0.02) this.emit(dt, x, y, z, fx, fz, strength, intensity, speed);

    // The bolts, redrawn on their own flicker clock.
    this.boltTimer -= dt;
    if (strength > 0.05 && this.tuning.bolts > 0) {
      if (this.boltTimer <= 0) {
        this.boltTimer = BOLT_REFRESH;
        this.drawBolts(x, y, z, fx, fz, strength, intensity);
      }
      this.bolts.visible = true;
      this.boltMaterial.opacity = 0.9 * strength;
    } else {
      this.bolts.visible = false;
      this.boltMaterial.opacity = 0;
    }

    // The ring under the feet, and the beam and halo above and behind.
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 9);
    this.ring.visible = strength > 0.02;
    this.ring.position.set(x, y + 0.08, z);
    this.ring.rotation.z = this.time * 2.5;
    const ringScale = (0.9 + 0.35 * intensity) * (0.85 + 0.15 * pulse);
    this.ring.scale.setScalar(ringScale);
    this.ringMaterial.opacity = 0.55 * strength * this.tuning.ring;

    const showBeam = this.tuning.beam && strength > 0.02;
    this.beam.visible = showBeam;
    if (showBeam) {
      this.beam.position.set(x - fx * POWER_SHAPES.beam.setBack, y + POWER_SHAPES.beam.lift, z - fz * POWER_SHAPES.beam.setBack);
      this.beam.rotation.y = this.time * 1.5;
      this.beam.scale.set(0.8 + 0.2 * intensity, 1, 0.8 + 0.2 * intensity);
    }
    const showHalo = this.tuning.halo && strength > 0.02;
    this.halo.visible = showHalo;
    if (showHalo) {
      this.halo.position.set(x, y + POWER_SHAPES.halo.lift + Math.sin(this.time * 3) * 0.08, z);
      this.halo.rotation.z = this.time * 1.2;
      this.halo.scale.setScalar(1 + 0.1 * intensity);
    }
    this.beamMaterial.opacity = 0.42 * strength;

    this.pool.update(dt);
  }

  /** Drop everything, e.g. on a respawn: the wake belongs to a run that ended. */
  clear(): void {
    this.pool.clear();
    this.charge = 0;
    this.bolts.visible = false;
    this.ring.visible = false;
    this.beam.visible = false;
    this.halo.visible = false;
  }

  dispose(): void {
    this.pool.dispose();
    this.boltGeometry.dispose();
    this.boltMaterial.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.beamGeometry.dispose();
    this.beamMaterial.dispose();
    this.haloGeometry.dispose();
    this.root.removeFromParent();
  }

  /** The wake: particles streaming back from the feet. */
  private emit(
    dt: number,
    x: number,
    y: number,
    z: number,
    fx: number,
    fz: number,
    strength: number,
    intensity: number,
    speed: number,
  ): void {
    const t = this.tuning;
    // Rate scales with intensity AND budget, so a low-budget remote spawns a
    // fraction of the particles rather than the same number smaller.
    this.spawnDebt += t.rate * (0.6 + intensity * 0.5) * strength * dt;
    const count = Math.floor(this.spawnDebt);
    this.spawnDebt -= count;
    spawnWake(this.pool, this.power, t, count, x, y, z, fx, fz, intensity, speed);
  }

  /**
   * Forked lightning behind the runner: a handful of jagged bright lines
   * from above the head down to the ground, redrawn every refresh so they
   * flicker. Each bolt also drops a few glow points into the pool.
   */
  private drawBolts(
    x: number,
    y: number,
    z: number,
    fx: number,
    fz: number,
    strength: number,
    intensity: number,
  ): void {
    const wanted = this.tuning.bolts * intensity * this.budget;
    const count = Math.min(MAX_BOLTS, Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0));
    let vertex = 0;
    for (let b = 0; b < count; b += 1) {
      vertex = writeBolt(this.boltPositions, vertex, this.pool, this.power, x, y, z, fx, fz, strength, intensity);
    }
    (this.boltGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.boltGeometry.setDrawRange(0, vertex / 3);
  }
}
