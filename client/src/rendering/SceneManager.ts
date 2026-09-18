import { AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Scene } from 'three';
import { PALETTE, WORLD_FOG } from '../config/worldVisuals.js';

/**
 * The scene root and the base lighting rig.
 *
 * OLYMPUS AT MIDDAY. Bright and warm: a sky-blue hemisphere over a
 * marble-bounce ground, a soft ambient so no face is ever dark, and a warm
 * sun key that gives every box a lit face and a shaded one. Three lights,
 * because every extra one is paid for by every fragment in the world.
 */
export class SceneManager {
  readonly scene = new Scene();
  readonly sun: DirectionalLight;

  constructor() {
    this.scene.fog = new Fog(PALETTE.fog, WORLD_FOG.near, WORLD_FOG.far);
    this.setBackground();

    const hemi = new HemisphereLight(0xbfe3ff, 0xf3e6cf, 1.05);
    hemi.position.set(0, 80, 0);
    this.scene.add(hemi);

    this.scene.add(new AmbientLight(0xffffff, 0.5));

    this.sun = new DirectionalLight(0xfff4dc, 2.1);
    this.sun.position.set(40, 90, -30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  /** Keep the shadow frustum over the player. */
  followShadow(x: number, y: number, z: number): void {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + 40, y + 90, z - 30);
    this.sun.target.updateMatrixWorld();
  }

  setBackground(color: number = PALETTE.fog): void {
    this.scene.background = new Color(color);
  }
}
