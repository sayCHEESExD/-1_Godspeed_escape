import { BufferAttribute, BufferGeometry, Color, Points, type ShaderMaterial } from 'three';
import { createPointsMaterial } from './pointsMaterial.js';

/**
 * A fixed pool of particles behind ONE `Points` mesh.
 *
 * Allocated once at its capacity and rewritten in place every frame: an
 * effect that allocated per particle would be the frame's whole garbage budget
 * at a sprint. A spawn that finds nothing free takes the oldest slot, so the
 * pool is a hard ceiling rather than a hope.
 *
 * Every particle has a position, a velocity, a colour, a size and a life. The
 * pool integrates them; the effect that owns it decides what to spawn.
 */
export class ParticlePool {
  readonly points: Points;
  readonly material: ShaderMaterial;

  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly lives: Float32Array;
  /** Per-particle simulation state, off the GPU. */
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly decay: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;

  private cursor = 0;
  private alive = 0;

  private readonly geometry = new BufferGeometry();
  private readonly scratch = new Color();

  constructor(capacity: number, additive = true) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.lives = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.decay = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aLife', new BufferAttribute(this.lives, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = createPointsMaterial(additive);
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get liveCount(): number {
    return this.alive;
  }

  /**
   * Spawn one particle.
   *
   * @param life     seconds it lives
   * @param gravity  downward acceleration, world units per second squared
   * @param drag     fraction of velocity lost per second
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size: number,
    life: number,
    gravity = 0,
    drag = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.lives[i] === 0) this.alive += 1;

    const at = i * 3;
    this.positions[at] = x;
    this.positions[at + 1] = y;
    this.positions[at + 2] = z;
    this.scratch.setHex(color);
    this.colors[at] = this.scratch.r;
    this.colors[at + 1] = this.scratch.g;
    this.colors[at + 2] = this.scratch.b;
    this.sizes[i] = size;
    this.lives[i] = 1;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.decay[i] = 1 / Math.max(0.05, life);
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  /** Integrate every live particle and upload. Free when none is alive. */
  update(delta: number): void {
    if (this.alive === 0) {
      this.points.visible = false;
      return;
    }
    const dt = Math.max(0, delta);
    let alive = 0;
    let maxIndex = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      let life = this.lives[i] as number;
      if (life <= 0) continue;
      life -= (this.decay[i] as number) * dt;
      if (life <= 0) {
        this.lives[i] = 0;
        continue;
      }
      this.lives[i] = life;
      alive += 1;
      maxIndex = i;

      const k = Math.max(0, 1 - (this.drag[i] as number) * dt);
      this.vx[i] = (this.vx[i] as number) * k;
      this.vz[i] = (this.vz[i] as number) * k;
      this.vy[i] = ((this.vy[i] as number) - (this.gravity[i] as number) * dt) * k;
      const at = i * 3;
      this.positions[at] = (this.positions[at] as number) + (this.vx[i] as number) * dt;
      this.positions[at + 1] = (this.positions[at + 1] as number) + (this.vy[i] as number) * dt;
      this.positions[at + 2] = (this.positions[at + 2] as number) + (this.vz[i] as number) * dt;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
    this.geometry.setDrawRange(0, maxIndex + 1);
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLife') as BufferAttribute).needsUpdate = true;
  }

  /** Kill every particle, e.g. on a respawn. */
  clear(): void {
    this.lives.fill(0);
    this.alive = 0;
    this.points.visible = false;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
