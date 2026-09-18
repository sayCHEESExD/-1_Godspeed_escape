import { COURSE_HAZARDS, hazardPositionAt, type CourseHazard } from '@godspeed/shared';
import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';

const WARN_LIFT = 0.06;

/**
 * Everything in the world that moves and kills.
 *
 * Every position is a PURE FUNCTION of the server's clock, evaluated by the
 * identical `hazardPositionAt` the server kills with. Five shapes, one loop:
 *
 *  - a SWEEPER is a THUNDER ORB: a crimson sphere with a crackling core,
 *    sweeping across the corridor;
 *  - a SPINNER segment is a BEAM OF LIGHT: several at stepped radii are one
 *    rigid bar sweeping round a hub;
 *  - a FALLER is a THUNDER STONE: a grey block that drops onto a warning
 *    patch and winches back up;
 *  - a SPIKE is a GOLDEN SPEAR with a crimson tip;
 *  - a TORNADO is an energy vortex.
 *
 * Crimson is the promise: everything crimson ends the run.
 */
export class Hazards {
  readonly root = new Group();

  private readonly meshes: Mesh[] = [];
  private readonly cores: (Mesh | null)[] = [];
  private readonly warnings: (Mesh | null)[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly at = { x: 0, y: 0, z: 0 };

  constructor() {
    const ball = this.keep(new SphereGeometry(1, 16, 12));
    const core = this.keep(new OctahedronGeometry(0.55, 0));
    const bar = this.keep(new BoxGeometry(1, 1, 1));
    const patch = this.keep(new CircleGeometry(1, 18));
    const spear = this.keep(new ConeGeometry(1, 2.6, 5));

    const hazardMaterial = this.keepMaterial(this.lit(PALETTE.hazard, 0.75));
    const coreMaterial = this.keepMaterial(this.lit(PALETTE.hazardCore, 1.4));
    const stoneMaterial = this.keepMaterial(new MeshLambertMaterial({ color: PALETTE.stone }));
    const spearMaterial = this.keepMaterial(new MeshLambertMaterial({ color: PALETTE.spike }));
    const tipMaterial = this.keepMaterial(this.lit(PALETTE.spikeTip, 0.7));
    const vortexMaterial = this.keepMaterial(
      new MeshLambertMaterial({ color: PALETTE.hazard, transparent: true, opacity: 0.7 }),
    );
    const warnMaterial = this.keepMaterial(
      new MeshBasicMaterial({ color: PALETTE.impactWarn, transparent: true, opacity: 0.42, depthWrite: false }),
    );

    for (const hazard of COURSE_HAZARDS) {
      let mesh: Mesh;
      let inner: Mesh | null = null;
      switch (hazard.kind) {
        case 'spinner':
          mesh = new Mesh(bar, hazardMaterial);
          mesh.scale.set(hazard.radius * 2.1, hazard.radius * 1.4, hazard.radius * 2.1);
          break;
        case 'faller':
          mesh = new Mesh(bar, stoneMaterial);
          mesh.scale.set(hazard.radius * 1.8, hazard.radius * 1.8, hazard.radius * 1.8);
          break;
        case 'tornado':
          mesh = new Mesh(bar, vortexMaterial);
          mesh.scale.set(hazard.radius * 1.7, hazard.radius * 4, hazard.radius * 1.7);
          break;
        case 'spike': {
          mesh = new Mesh(spear, spearMaterial);
          mesh.scale.set(hazard.radius * 0.7, hazard.radius * 1.15, hazard.radius * 0.7);
          const tip = new Mesh(spear, tipMaterial);
          tip.position.y = 0.7;
          tip.scale.setScalar(0.4);
          mesh.add(tip);
          break;
        }
        default: {
          // The thunder orb: a crimson sphere with a bright spinning core.
          mesh = new Mesh(ball, hazardMaterial);
          mesh.scale.setScalar(hazard.radius);
          inner = new Mesh(core, coreMaterial);
          mesh.add(inner);
        }
      }

      mesh.position.set(hazard.x, hazard.y, hazard.z);
      mesh.castShadow = true;
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.cores.push(inner);
      this.warnings.push(hazard.kind === 'faller' ? this.addWarning(patch, warnMaterial, hazard) : null);
    }
  }

  update(elapsed: number): void {
    for (let i = 0; i < this.meshes.length; i += 1) {
      const hazard = COURSE_HAZARDS[i];
      const mesh = this.meshes[i];
      if (!hazard || !mesh) continue;
      if (hazard.kind === 'spike') continue;

      hazardPositionAt(hazard, elapsed, this.at);
      mesh.position.set(this.at.x, this.at.y, this.at.z);

      switch (hazard.kind) {
        case 'spinner':
          mesh.rotation.y = -Math.atan2(this.at.z - hazard.z, this.at.x - hazard.x);
          break;
        case 'tornado':
          mesh.rotation.y = elapsed * 4;
          break;
        case 'faller': {
          const warning = this.warnings[i];
          if (warning) {
            const fallen = 1 - (this.at.y - hazard.y) / Math.max(1, hazard.sweep);
            warning.scale.setScalar(hazard.radius * (1.9 - fallen * 0.6));
            (warning.material as MeshBasicMaterial).opacity = 0.2 + fallen * 0.42;
          }
          mesh.rotation.y = hazard.phase;
          break;
        }
        case 'roller':
          mesh.rotation.x = -this.at.z / hazard.radius;
          break;
        default: {
          mesh.rotation.z = -this.at.x / hazard.radius;
          const inner = this.cores[i];
          if (inner) {
            inner.rotation.y = elapsed * 6;
            inner.rotation.x = elapsed * 4;
          }
        }
      }
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }

  private addWarning(geometry: BufferGeometry, material: Material, hazard: CourseHazard): Mesh {
    const mesh = new Mesh(geometry, material.clone());
    this.materials.push(mesh.material as Material);
    mesh.rotation.x = -Math.PI / 2;
    // The patch lies on the surface the stone rests on: its authored Y is the
    // stone's centre at rest, one radius above the floor.
    mesh.position.set(hazard.x, hazard.y - hazard.radius + WARN_LIFT, hazard.z);
    mesh.scale.setScalar(hazard.radius * 1.9);
    this.root.add(mesh);
    return mesh;
  }

  private lit(color: number, intensity: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    material.emissive.setHex(color);
    material.emissiveIntensity = intensity;
    return material;
  }

  private keep<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private keepMaterial<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}
