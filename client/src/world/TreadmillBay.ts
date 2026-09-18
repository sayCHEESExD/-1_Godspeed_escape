import {
  TREADMILLS,
  TREADMILL_BELT_Y,
  TREADMILL_COUNT,
  treadmillX,
  treadmillZ,
} from '@godspeed/shared';
import { Group, Mesh, MeshLambertMaterial, type BufferGeometry, type Texture } from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

/** How fast the tread texture scrolls, in texture repeats per second. */
const BELT_SCROLL = 1.3;

/**
 * THE TREADMILL BAY on the player's RIGHT.
 *
 * Three identical machines that LOOK LIKE TREADMILLS: a long dark belt
 * between two blue rails, a drive roller at the back, a console post at the
 * head with a lit screen, and a floating "1x Speed" label over each - as the
 * reference art has them. They face the spawn (+X), so a runner on one looks
 * back at the hub.
 *
 * The belts and rails are real solids in the shared course data; everything
 * here is the machine around them.
 */
export class TreadmillBay {
  readonly root = new Group();

  private readonly belts: Mesh[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshLambertMaterial[] = [];
  private time = 0;

  constructor(beltTexture: Texture) {
    const frame = this.material(PALETTE.treadmillFrame);
    const lit = this.lit(PALETTE.treadmillFrameLit, 1.0);
    const screen = this.lit(0x0b1a2a, 0.3);
    const gold = this.lit(PALETTE.gold, 0.35);

    const beltMaterial = this.material(0xffffff);
    beltMaterial.map = beltTexture;
    beltMaterial.emissive.setHex(0xffffff);
    beltMaterial.emissiveIntensity = 0.25;
    beltMaterial.emissiveMap = beltTexture;

    const L = TREADMILLS.beltLength;
    const W = TREADMILLS.beltWidth;

    // THE DRESSING ENCLOSES THE SOLIDS. The belt and rail solids are drawn by
    // the world as plain blocks; the tread and rail caps here are sized to
    // swallow those blocks with no two faces on the same plane, because two
    // coplanar faces z-fight and the belt flickered like loose floorboards.
    // The belt solid runs y 0.5-1.0 and the rails y 0.5-0.95 in world space;
    // this rig sits at y 1.0.
    const tread = this.geometry(L - 0.4, 0.5, W - 0.3);
    const railTop = this.geometry(L + 1.3, 0.49, 1.08);
    const roller = this.geometry(0.9, 0.9, W + 0.6);
    const post = this.geometry(0.6, 3.6, 0.6);
    const head = this.geometry(1.2, 0.5, W + 1.0);
    const face = this.geometry(0.2, 1.6, W - 0.6);
    const bezel = this.geometry(0.3, 2.0, W - 0.2);
    const strip = this.geometry(L + 1.2, 0.12, 0.3);

    for (let index = 1; index <= TREADMILL_COUNT; index += 1) {
      const rig = new Group();
      rig.position.set(treadmillX(index), TREADMILL_BELT_Y, treadmillZ(index));

      // The running tread, from just above the deck to a hair above the belt
      // solid (world 0.52-1.02), scrolling toward the runner's back.
      const surface = this.mesh(tread, beltMaterial, 0, -0.23, 0);
      rig.add(surface);
      this.belts.push(surface);

      // Rail caps swallowing the rail solids (world 0.52-1.01) and a lit strip
      // standing on each cap.
      for (const side of [-1, 1]) {
        rig.add(this.mesh(railTop, frame, 0, -0.235, side * (W / 2 + 0.55)));
        rig.add(this.mesh(strip, lit, 0, 0.06, side * (W / 2 + 0.55)));
      }

      // The drive roller at the back.
      rig.add(this.mesh(roller, frame, -(L / 2 + 0.1), 0.15, 0));

      // The console: post, head bar, lit screen with a bezel.
      const headX = L / 2 + 1.1;
      for (const side of [-1, 1]) {
        rig.add(this.mesh(post, frame, headX, 2.0, side * (W / 2 + 0.6)));
      }
      rig.add(this.mesh(head, gold, headX, 3.9, 0));
      rig.add(this.mesh(bezel, frame, headX, 3.0, 0));
      rig.add(this.mesh(face, screen, headX - 0.16, 3.0, 0));

      // The label, floating over the console and facing the spawn.
      const sign = new CanvasSign(7, 2.4, [
        { text: '1x Speed', size: 1, fill: '#ffe08a', stroke: '#2a1a05', strokeWidth: 0.16 },
      ]);
      sign.mesh.position.set(headX, 5.6, 0);
      sign.mesh.rotation.y = Math.PI / 2;
      rig.add(sign.mesh);
      this.signs.push(sign);

      this.root.add(rig);
    }

    // The bay's own title, high over the middle rig.
    const title = new CanvasSign(22, 5, [
      { text: 'TREADMILLS', size: 1, fill: '#ffffff', stroke: '#1c2233', strokeWidth: 0.16 },
      { text: 'Run to earn Speed', size: 0.55, fill: '#7fe6ff', stroke: '#0b2a3a', strokeWidth: 0.14 },
    ]);
    title.mesh.position.set(TREADMILLS.columnX - 2, 12, (TREADMILLS.minZ + TREADMILLS.maxZ) / 2);
    title.mesh.rotation.y = Math.PI / 2;
    this.root.add(title.mesh);
    this.signs.push(title);
  }

  /** Scroll the treads, so a machine standing empty still looks like it runs. */
  update(delta: number): void {
    this.time += delta;
    for (const belt of this.belts) {
      const material = belt.material as MeshLambertMaterial;
      if (!material.map) continue;
      material.map.offset.x = (this.time * BELT_SCROLL) % 1;
    }
  }

  private mesh(geometry: BufferGeometry, material: MeshLambertMaterial, x: number, y: number, z: number): Mesh {
    const node = new Mesh(geometry, material);
    node.position.set(x, y, z);
    node.castShadow = true;
    node.receiveShadow = true;
    return node;
  }

  private geometry(w: number, h: number, d: number): BufferGeometry {
    const geometry = texturedBox(w, h, d, 3);
    this.geometries.push(geometry);
    return geometry;
  }

  private material(color: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }

  private lit(color: number, intensity: number): MeshLambertMaterial {
    const material = this.material(color);
    material.emissive.setHex(color);
    material.emissiveIntensity = intensity;
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const sign of this.signs) sign.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.signs.length = 0;
    this.belts.length = 0;
    this.root.removeFromParent();
  }
}
