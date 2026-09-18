import { SINKING_SOLIDS, sinkingOffsetAt } from '@godspeed/shared';
import { Color, Group, Mesh, MeshLambertMaterial, type Texture } from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { texturedBox } from './texturedBox.js';

const SHAKE_RATE = 30;
const SHAKE_AMOUNT = 0.14;

/**
 * The CLOUDS THAT FADE, and the golden shutters of the Halls.
 *
 * Their height is a PURE FUNCTION of the replicated clock, evaluated by the
 * exact same `sinkingOffsetAt` the server collides against. A cloud about to
 * go shakes and flushes pink for a beat first, so crossing is a decision
 * rather than a coin flip.
 */
export class SinkingPlatforms {
  readonly root = new Group();

  private readonly meshes: Mesh[] = [];
  private readonly baseY: number[] = [];
  private readonly baseX: number[] = [];
  private readonly steady: MeshLambertMaterial;
  private readonly warning: MeshLambertMaterial;
  private readonly shutter: MeshLambertMaterial;
  private readonly shutterWarning: MeshLambertMaterial;

  constructor(cloudTexture: Texture) {
    this.steady = new MeshLambertMaterial({ map: cloudTexture });
    this.steady.emissive.setHex(0xffffff);
    this.steady.emissiveIntensity = 0.12;
    this.warning = new MeshLambertMaterial({
      map: cloudTexture,
      color: new Color(PALETTE.sinkingWarn),
      emissive: new Color(PALETTE.sinkingWarn),
      emissiveIntensity: 0.35,
    });
    this.shutter = new MeshLambertMaterial({ color: PALETTE.gold });
    this.shutter.emissive.setHex(PALETTE.gold);
    this.shutter.emissiveIntensity = 0.2;
    this.shutterWarning = new MeshLambertMaterial({ color: PALETTE.hazard });
    this.shutterWarning.emissive.setHex(PALETTE.hazard);
    this.shutterWarning.emissiveIntensity = 0.5;

    for (const platform of SINKING_SOLIDS) {
      const width = platform.maxX - platform.minX;
      const height = platform.maxY - platform.minY;
      const depth = platform.maxZ - platform.minZ;
      const geometry = texturedBox(width, height, depth, 4);
      const mesh = new Mesh(geometry, this.isShutter(platform) ? this.shutter : this.steady);
      const x = (platform.minX + platform.maxX) / 2;
      const y = (platform.minY + platform.maxY) / 2;
      mesh.position.set(x, y, (platform.minZ + platform.maxZ) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.baseY.push(y);
      this.baseX.push(x);
    }
  }

  update(elapsed: number): void {
    for (let i = 0; i < this.meshes.length; i += 1) {
      const platform = SINKING_SOLIDS[i];
      const mesh = this.meshes[i];
      const baseY = this.baseY[i];
      const baseX = this.baseX[i];
      if (!platform || !mesh || baseY === undefined || baseX === undefined) continue;

      const { drop, warning } = sinkingOffsetAt(platform, elapsed);
      mesh.position.y = baseY - drop;
      mesh.position.x = warning ? baseX + Math.sin(elapsed * SHAKE_RATE + i) * SHAKE_AMOUNT : baseX;

      const shutter = this.isShutter(platform);
      const material = warning
        ? shutter ? this.shutterWarning : this.warning
        : shutter ? this.shutter : this.steady;
      if (mesh.material !== material) mesh.material = material;
    }
  }

  /** A shutter is a sinking solid taller than it is long: a wall, not a floor. */
  private isShutter(platform: (typeof SINKING_SOLIDS)[number]): boolean {
    return platform.maxY - platform.minY > platform.maxZ - platform.minZ * 1 + 4;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.meshes.length = 0;
    this.steady.dispose();
    this.warning.dispose();
    this.shutter.dispose();
    this.shutterWarning.dispose();
    this.root.removeFromParent();
  }
}
