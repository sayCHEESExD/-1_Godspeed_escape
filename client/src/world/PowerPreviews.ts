import { SPEED_UPGRADES, UPGRADE_ROWS, upgradeTileX, upgradeTileY, upgradeTileZ, type GodPower } from '@godspeed/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BOLT_POINTS,
  BOLT_REFRESH,
  POWER_SHAPES,
  STYLES,
  spawnWake,
  writeBolt,
  type StyleTuning,
} from '../effects/GodPowerEffect.js';
import { ParticlePool } from '../effects/ParticlePool.js';

/** How large a preview is next to the real thing. */
const SCALE = 0.6;
/** Fraction of the sprint effect's particle rate each stand runs at. */
const WAKE_BUDGET = 0.35;
/** Fraction of the sprint effect's bolt count each stand runs at. */
const BOLT_BUDGET = 0.7;
/** Most bolts one stand shows per refresh. */
const MAX_BOLTS_EACH = 2;
/** One pool for all fifteen stands: about 70 live particles each. */
const POOL_SIZE = 1200;
/** Beyond this distance from the terraces (in the flat) the stands sleep. */
const WAKE_RANGE = 170;

/** One tile's power, standing on the tile. */
interface Stand {
  readonly x: number;
  /** Where the power's "feet" are: just above the tile's lit face. */
  readonly y: number;
  readonly z: number;
  readonly power: GodPower;
  readonly tuning: StyleTuning;
  wakeDebt: number;
}

/**
 * THE GOD-POWER PREVIEWS on the speed upgrade tiles.
 *
 * Every one of the fifteen tiles runs a small live copy of the power its
 * tier unleashes while sprinting - the same style table, the same wake and
 * bolt emitters and the same ring, beam and halo shapes as `GodPowerEffect`,
 * at reduced size, standing still and facing the spawn so the wake streams away
 * from a player looking at it. A locked tile shows its power like any other:
 * the point is to see what is being saved for.
 *
 * Built to be cheap enough to run always: ONE particle pool and ONE points
 * draw for every stand, ONE line-segments draw for every bolt, ONE merged
 * mesh for the fifteen ground rings, and a beam or halo mesh only on the
 * tiers whose power has one. Each stand spawns a third of a sprint's
 * particles. The whole thing sleeps when the player is far from the hub.
 */
export class PowerPreviews {
  readonly root = new Group();

  private readonly pool = new ParticlePool(POOL_SIZE);
  private readonly stands: Stand[] = [];

  private readonly boltGeometry = new BufferGeometry();
  private readonly boltPositions: Float32Array;
  private readonly boltColors: Float32Array;
  private readonly boltMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  private readonly bolts: LineSegments;

  private readonly ringMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  private readonly rings: Mesh | null;

  private readonly lightMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  private readonly beams: Mesh[] = [];
  private readonly halos: Mesh[] = [];
  /** Where each halo hangs before its bob. */
  private readonly haloRestY: number[] = [];
  private readonly geometries: BufferGeometry[] = [];

  private readonly centreX: number;
  private readonly centreZ: number;
  private time = 0;
  private boltTimer = 0;
  private awake = true;
  private readonly scratch = new Color();

  constructor() {
    const beamGeometry = this.tinted(
      new CylinderGeometry(
        POWER_SHAPES.beam.top * SCALE,
        POWER_SHAPES.beam.bottom * SCALE,
        POWER_SHAPES.beam.height * SCALE,
        POWER_SHAPES.beam.segments,
        1,
        true,
      ),
      null,
    );
    const haloGeometry = this.tinted(
      new RingGeometry(POWER_SHAPES.halo.inner * SCALE, POWER_SHAPES.halo.outer * SCALE, POWER_SHAPES.halo.segments),
      null,
    );

    const ringParts: BufferGeometry[] = [];
    for (const tier of SPEED_UPGRADES) {
      const x = upgradeTileX(tier.slot);
      const y = upgradeTileY(tier.slot) + UPGRADE_ROWS.tileHeight + 0.24;
      const z = upgradeTileZ(tier.slot);
      const { power } = tier;
      const tuning = STYLES[power.style];
      this.stands.push({ x, y, z, power, tuning, wakeDebt: Math.random() });

      // The ground ring, in the tier's colour, at the size the sprint draws it.
      const ring = new RingGeometry(POWER_SHAPES.ring.inner, POWER_SHAPES.ring.outer, POWER_SHAPES.ring.segments);
      ring.rotateX(-Math.PI / 2);
      ring.scale(SCALE * (0.9 + 0.35 * power.intensity), 1, SCALE * (0.9 + 0.35 * power.intensity));
      ring.translate(x, y - 0.1, z);
      ringParts.push(this.tinted(ring, power.color));

      // A beam and a halo only where the power has them.
      if (tuning.beam) {
        const beam = new Mesh(beamGeometry, this.lightMaterial);
        // Set back along the wake (+X: the stands face the spawn at -X).
        beam.position.set(x + POWER_SHAPES.beam.setBack * SCALE, y + POWER_SHAPES.beam.lift * SCALE, z);
        const spread = 0.8 + 0.2 * power.intensity;
        beam.scale.set(spread, 1, spread);
        this.paint(beam, power.color, beamGeometry.getAttribute('position').count);
        this.beams.push(beam);
        this.root.add(beam);
      }
      if (tuning.halo) {
        const halo = new Mesh(haloGeometry, this.lightMaterial);
        halo.rotation.x = -Math.PI / 2;
        halo.position.set(x, y + POWER_SHAPES.halo.lift * SCALE, z);
        halo.scale.setScalar(1 + 0.1 * power.intensity);
        this.paint(halo, power.color, haloGeometry.getAttribute('position').count);
        this.halos.push(halo);
        this.haloRestY.push(halo.position.y);
        this.root.add(halo);
      }
    }

    const merged = mergeGeometries(ringParts, false);
    for (const part of ringParts) part.dispose();
    if (merged) {
      this.geometries.push(merged);
      this.rings = new Mesh(merged, this.ringMaterial);
      this.root.add(this.rings);
    } else {
      this.rings = null;
    }

    const boltFloats = this.stands.length * MAX_BOLTS_EACH * (BOLT_POINTS - 1) * 2 * 3;
    this.boltPositions = new Float32Array(boltFloats);
    this.boltColors = new Float32Array(boltFloats);
    this.boltGeometry.setAttribute('position', new BufferAttribute(this.boltPositions, 3));
    this.boltGeometry.setAttribute('color', new BufferAttribute(this.boltColors, 3));
    this.boltGeometry.setDrawRange(0, 0);
    this.bolts = new LineSegments(this.boltGeometry, this.boltMaterial);
    this.bolts.frustumCulled = false;
    this.root.add(this.bolts, this.pool.points);

    const xs = this.stands.map((s) => s.x);
    const zs = this.stands.map((s) => s.z);
    this.centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.centreZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  }

  /**
   * @param viewerX, viewerZ  where the local player is, so the stands can
   *                          sleep while nobody is near the hub
   */
  update(delta: number, viewerX: number, viewerZ: number): void {
    const dt = Math.max(0, delta);
    const dx = viewerX - this.centreX;
    const dz = viewerZ - this.centreZ;
    const near = dx * dx + dz * dz < WAKE_RANGE * WAKE_RANGE;
    if (near !== this.awake) {
      this.awake = near;
      this.bolts.visible = near;
      if (this.rings) this.rings.visible = near;
      for (const beam of this.beams) beam.visible = near;
      for (const halo of this.halos) halo.visible = near;
      if (!near) this.boltGeometry.setDrawRange(0, 0);
    }
    if (!near) {
      // Let what is in the air die; spawn nothing new.
      if (this.pool.liveCount > 0) this.pool.update(dt);
      return;
    }

    this.time += dt;

    // Every stand's wake, facing -X so it streams toward +X.
    for (const stand of this.stands) {
      const t = stand.tuning;
      stand.wakeDebt += t.rate * (0.6 + stand.power.intensity * 0.5) * WAKE_BUDGET * dt;
      const count = Math.floor(stand.wakeDebt);
      if (count === 0) continue;
      stand.wakeDebt -= count;
      spawnWake(this.pool, stand.power, t, count, stand.x, stand.y, stand.z, -1, 0, stand.power.intensity, 0, SCALE);
    }

    // The bolts of every stormy stand, on one flicker clock.
    this.boltTimer -= dt;
    if (this.boltTimer <= 0) {
      this.boltTimer = BOLT_REFRESH;
      this.drawBolts();
    }

    // The rings breathe, the beams turn, the halos bob.
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 9);
    this.ringMaterial.opacity = 0.4 * (0.85 + 0.15 * pulse);
    for (const beam of this.beams) beam.rotation.y = this.time * 1.5;
    const bob = Math.sin(this.time * 3) * 0.08 * SCALE;
    this.halos.forEach((halo, i) => {
      halo.position.y = (this.haloRestY[i] ?? halo.position.y) + bob;
      halo.rotation.z = this.time * 1.2;
    });

    this.pool.update(dt);
  }

  dispose(): void {
    this.pool.dispose();
    this.boltGeometry.dispose();
    this.boltMaterial.dispose();
    this.ringMaterial.dispose();
    this.lightMaterial.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.root.removeFromParent();
  }

  private drawBolts(): void {
    let vertex = 0;
    for (const stand of this.stands) {
      const t = stand.tuning;
      if (t.bolts === 0) continue;
      const wanted = t.bolts * stand.power.intensity * BOLT_BUDGET;
      const count = Math.min(MAX_BOLTS_EACH, Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0));
      if (count === 0) continue;
      const start = vertex;
      for (let b = 0; b < count; b += 1) {
        vertex = writeBolt(this.boltPositions, vertex, this.pool, stand.power, stand.x, stand.y, stand.z, -1, 0, 1, stand.power.intensity, SCALE);
      }
      this.scratch.setHex(stand.power.accent);
      for (let i = start; i < vertex; i += 3) {
        this.boltColors[i] = this.scratch.r;
        this.boltColors[i + 1] = this.scratch.g;
        this.boltColors[i + 2] = this.scratch.b;
      }
    }
    (this.boltGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.boltGeometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    this.boltGeometry.setDrawRange(0, vertex / 3);
  }

  /** Give a geometry a colour attribute, filled with one colour or left for `paint`. */
  private tinted(geometry: BufferGeometry, color: number | null): BufferGeometry {
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    if (color !== null) {
      this.scratch.setHex(color);
      for (let i = 0; i < count; i += 1) {
        colors[i * 3] = this.scratch.r;
        colors[i * 3 + 1] = this.scratch.g;
        colors[i * 3 + 2] = this.scratch.b;
      }
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.geometries.push(geometry);
    return geometry;
  }

  /**
   * Beams and halos share one geometry each but wear their tier's colour, so
   * every mesh gets its own copy of the colour attribute.
   */
  private paint(mesh: Mesh, color: number, count: number): void {
    const colors = new Float32Array(count * 3);
    this.scratch.setHex(color);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = this.scratch.r;
      colors[i * 3 + 1] = this.scratch.g;
      colors[i * 3 + 2] = this.scratch.b;
    }
    const own = mesh.geometry.clone();
    own.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.geometries.push(own);
    mesh.geometry = own;
  }
}
