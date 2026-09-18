import { COURSE_END_Z, COURSE_TOP_Y } from '@godspeed/shared';
import {
  BackSide,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/worldVisuals.js';

/** How far out the dome sits. Inside the camera's far plane. */
const DOME_RADIUS = 1500;

/**
 * The sky: a bright gradient dome and TWO fields of blocky clouds - one high
 * overhead and one BELOW the world, so what a player sees when they look over
 * an edge is a sea of cloud rather than nothing. Each cloud is a cluster of
 * boxes; the whole sky is a handful of merged meshes.
 */
export class Sky {
  readonly root = new Group();
  private readonly disposables: (BufferGeometry | ShaderMaterial | MeshBasicMaterial)[] = [];

  constructor() {
    this.root.add(this.buildDome());
    // Overhead, climbing with the course so the throne is still under cloud.
    this.buildClouds(0x9a1ce, 70, -400, COURSE_END_Z + 500, 90 + 0, 220 + COURSE_TOP_Y, 900);
    // Below, the sea: denser, lower, and it never rises past the hub floor.
    this.buildClouds(0x51ea, 110, -600, COURSE_END_Z + 600, -90, -34, 1100);
    this.root.renderOrder = -1;
  }

  private buildDome(): Mesh {
    const geometry = new SphereGeometry(DOME_RADIUS, 24, 16);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new Color(PALETTE.skyTop) },
        midColor: { value: new Color(PALETTE.sky) },
        bottomColor: { value: new Color(PALETTE.fog) },
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vHeight = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        varying float vHeight;
        void main() {
          float h = clamp(vHeight, -1.0, 1.0);
          vec3 sky = mix(midColor, topColor, clamp(h * 1.4, 0.0, 1.0));
          vec3 low = mix(bottomColor, midColor, clamp((h + 0.3) * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(h > 0.0 ? sky : low, 1.0);
        }
      `,
    });
    this.disposables.push(geometry, material);
    const dome = new Mesh(geometry, material);
    dome.frustumCulled = false;
    return dome;
  }

  private buildClouds(
    seed: number,
    clusters: number,
    fromZ: number,
    toZ: number,
    minY: number,
    maxY: number,
    halfWidth: number,
  ): void {
    const random = seeded(seed);
    const tops: BufferGeometry[] = [];
    const bases: BufferGeometry[] = [];

    for (let i = 0; i < clusters; i += 1) {
      const cx = (random() * 2 - 1) * halfWidth;
      const cy = minY + random() * (maxY - minY);
      const cz = fromZ + random() * (toZ - fromZ);
      const scale = 9 + random() * 18;
      const blocks = 5 + Math.floor(random() * 5);

      for (let b = 0; b < blocks; b += 1) {
        const t = blocks === 1 ? 0.5 : b / (blocks - 1);
        const bulge = Math.sin(t * Math.PI);
        const w = scale * (1.1 + bulge * 1.5 + random() * 0.4);
        const h = scale * (0.5 + bulge * 0.55);
        const d = scale * (1.0 + bulge * 1.2 + random() * 0.4);
        const x = cx + (t - 0.5) * scale * 4.2;
        const y = cy + bulge * scale * 0.35 + (random() - 0.5) * scale * 0.2;
        const z = cz + (random() - 0.5) * scale * 1.2;

        const top = new BoxGeometry(w, h, d);
        top.translate(x, y, z);
        tops.push(top);
        const base = new BoxGeometry(w * 1.04, h * 0.32, d * 1.04);
        base.translate(x, y - h * 0.62, z);
        bases.push(base);
      }
    }

    this.addLayer(tops, PALETTE.skyCloud);
    this.addLayer(bases, PALETTE.skyCloudShade);
  }

  private addLayer(parts: BufferGeometry[], color: number): void {
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return;
    const material = new MeshBasicMaterial({ color, fog: false });
    this.disposables.push(merged, material);
    const mesh = new Mesh(merged, material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.root.removeFromParent();
  }
}

const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
