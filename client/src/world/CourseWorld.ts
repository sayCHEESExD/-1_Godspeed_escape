import {
  COURSE,
  COURSE_END_Z,
  COURSE_SOLIDS,
  DECORATIONS,
  QUICKSAND,
  STAGES,
  UPGRADE_ROWS,
  WIDE_AREAS,
  WIN_PAD,
  WorldCollision,
  corridorHalfWidthAt,
  courseHeightAt,
  formatWins,
  type CourseSolid,
  type SolidKind,
} from '@godspeed/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { accentForStage, PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { loadSharedImage, onImageDecoded } from './ImageBillboard.js';
import { WinTrophies } from './WinTrophies.js';
import { Scoreboard } from './Scoreboard.js';
import { Hazards } from './Hazards.js';
import { SinkingPlatforms } from './SinkingPlatforms.js';
import { Sky } from './Sky.js';
import { StageSigns } from './StageSigns.js';
import { StageReveal } from './StageReveal.js';
import { TreadmillBay } from './TreadmillBay.js';
import { UpgradeTerraces } from './UpgradeTerraces.js';
import { WorldTextures } from './WorldTextures.js';
import { texturedBox } from './texturedBox.js';

/** World units one repeat of a tiling texture covers. */
const TILE = 6;

const WIN_GLOW = { base: 0.35, swing: 0.3, haloBase: 0.16, haloSwing: 0.16, rate: 2.1 } as const;
const PLINTH = { margin: 1.2, height: 0.4 } as const;
const CUP_HEIGHT = 1.8;
const CUPS = [
  { x: -0.62, z: 0.34, scale: 1, lift: 0 },
  { x: 0.46, z: -0.18, scale: 0.86, lift: 0 },
  { x: -0.18, z: 0.72, scale: 0.62, lift: 1.4 },
] as const;
const TROPHY_URL = '/ui/trophy.png';

/** Geometry lists bucketed by colour, so lit hardware merges per colour. */
const bucket = (into: Map<number, BufferGeometry[]>, color: number): BufferGeometry[] => {
  const found = into.get(color);
  if (found) return found;
  const made: BufferGeometry[] = [];
  into.set(color, made);
  return made;
};

/**
 * The visible world: OLYMPUS.
 *
 * Every solid it draws comes from `COURSE_SOLIDS` - the SAME array the
 * collision model is built from - so a platform the player can see but not
 * stand on is structurally impossible. Geometry is merged per material, so a
 * three-kilometre climb is a couple of dozen draw calls.
 */
export class CourseWorld {
  readonly root = new Group();
  readonly collision = new WorldCollision();

  readonly hazards: Hazards;
  readonly terraces: UpgradeTerraces;
  readonly signs: StageSigns;
  readonly treadmills: TreadmillBay;
  readonly sinking: SinkingPlatforms;
  readonly scoreboard: Scoreboard;
  readonly sky: Sky;
  readonly winTrophies = new WinTrophies();

  private readonly textures = new WorldTextures();
  private readonly materials: Material[] = [];
  private winReveal: StageReveal | null = null;
  private cupMesh: Mesh | null = null;
  private winPadMaterial: MeshLambertMaterial | null = null;
  private winHaloMaterial: MeshLambertMaterial | null = null;
  private launchMaterial: MeshLambertMaterial | null = null;
  private readonly gems: Mesh[] = [];
  private glowTime = 0;

  constructor() {
    this.buildSolids();
    this.buildCloudSea();
    this.buildBalustrades();
    this.buildDecorations();
    this.buildWinPadSigns();
    this.buildTitle();

    this.root.add(this.winTrophies.root);

    this.hazards = new Hazards();
    this.root.add(this.hazards.root);

    this.sinking = new SinkingPlatforms(this.textures.cloud(PALETTE.cloud, PALETTE.cloudShade));
    this.root.add(this.sinking.root);

    this.terraces = new UpgradeTerraces();
    this.root.add(this.terraces.root);

    this.signs = new StageSigns();
    this.root.add(this.signs.root);

    this.treadmills = new TreadmillBay(this.textures.belt(PALETTE.treadmillBelt, PALETTE.treadmillMark));
    this.root.add(this.treadmills.root);

    this.scoreboard = new Scoreboard();
    this.root.add(this.scoreboard.root);

    this.sky = new Sky();
    this.root.add(this.sky.root);
  }

  addTo(scene: Scene): void {
    scene.add(this.root);
  }

  revealNear(z: number): void {
    this.signs.revealNear(z);
    this.winReveal?.revealNear(z);
  }

  /** @param viewerX, viewerZ  the local player, for effects that sleep when far */
  update(delta: number, elapsed: number, viewerX: number, viewerZ: number): void {
    this.hazards.update(elapsed);
    this.sinking.update(elapsed);
    this.terraces.update(delta, viewerX, viewerZ);
    this.treadmills.update(delta);
    this.pulse(delta);
    this.winTrophies.update(delta);
  }

  dispose(): void {
    this.textures.dispose();
    for (const material of this.materials) material.dispose();
    this.winReveal?.dispose();
    this.winReveal = null;
    this.cupMesh?.geometry.dispose();
    this.winTrophies.dispose();
    this.hazards.dispose();
    this.sinking.dispose();
    this.terraces.dispose();
    this.signs.dispose();
    this.treadmills.dispose();
    this.scoreboard.dispose();
    this.sky.dispose();
    this.root.removeFromParent();
  }

  /** Draw every solid, grouped by kind so each group is one mesh. */
  private buildSolids(): void {
    const byKind = new Map<SolidKind, BufferGeometry[]>();
    for (const solid of COURSE_SOLIDS) {
      const list = byKind.get(solid.kind) ?? [];
      list.push(boxFor(solid, TILE));
      byKind.set(solid.kind, list);
    }
    for (const [kind, geometries] of byKind) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      const mesh = new Mesh(merged, this.materialFor(kind));
      mesh.receiveShadow = true;
      mesh.castShadow = kind === 'block' || kind === 'pillar' || kind === 'wall' || kind === 'island' || kind === 'bridge';
      this.root.add(mesh);
    }
  }

  /** The cloud sea under every stretch of platforms, in whatever it is made of. */
  private buildCloudSea(): void {
    if (QUICKSAND.length === 0) return;
    const byMaterial = new Map<string, BufferGeometry[]>();
    for (const pit of QUICKSAND) {
      const geometry = texturedBox(pit.maxX - pit.minX, 2.5, pit.maxZ - pit.minZ, TILE * 3);
      geometry.translate((pit.minX + pit.maxX) / 2, pit.surfaceY - 1.25, (pit.minZ + pit.maxZ) / 2);
      const list = byMaterial.get(pit.surface);
      if (list) list.push(geometry);
      else byMaterial.set(pit.surface, [geometry]);
    }
    for (const [surface, parts] of byMaterial) {
      const colours =
        surface === 'storm'
          ? [PALETTE.stormSea, PALETTE.stormSeaShade]
          : surface === 'void'
            ? [PALETTE.voidSea, PALETTE.voidSeaShade]
            : [PALETTE.cloudSea, PALETTE.cloudSeaShade];
      const material = new MeshLambertMaterial({
        map: this.textures.sea(colours[0] as string, colours[1] as string),
      });
      if (surface === 'cloud') {
        material.emissive.setHex(0xffffff);
        material.emissiveIntensity = 0.18;
      }
      this.materials.push(material);
      this.addMerged(parts, material, false);
    }
  }

  /**
   * THE BALUSTRADES: a low marble rail on posts along both edges of the
   * course, with a gold cap. Scenery: the X clamp is what holds the player.
   */
  private buildBalustrades(): void {
    const rails: BufferGeometry[] = [];
    const posts: BufferGeometry[] = [];
    const caps = new Map<number, BufferGeometry[]>();

    const run = (halfWidth: number, fromZ: number, toZ: number, y: (z: number) => number): void => {
      const length = toZ - fromZ;
      if (length <= 6) return;
      for (const side of [-1, 1]) {
        const x = side * (halfWidth + 0.9);
        // Posts every 8 units, following the course height.
        for (let z = fromZ + 4; z < toZ - 2; z += 8) {
          const base = y(z);
          const post = texturedBox(0.9, COURSE.wallHeight, 0.9, TILE);
          post.translate(x, base + COURSE.wallHeight / 2, z);
          posts.push(post);
          const rail = texturedBox(0.5, 0.5, 8, TILE);
          rail.translate(x, base + COURSE.wallHeight - 0.25, z + 4);
          rails.push(rail);
          const cap = texturedBox(1.2, 0.3, 1.2, TILE);
          cap.translate(x, base + COURSE.wallHeight + 0.15, z);
          const stage = STAGES.find((s) => z >= s.startZ && z <= s.endZ);
          bucket(caps, stage ? accentForStage(stage.index) : PALETTE.gold).push(cap);
        }
      }
    };

    // The hub's edge: a rail around three sides.
    run(COURSE.lobbyHalfWidth, COURSE.lobbyStartZ, COURSE.lobbyEndZ - 6, () => COURSE.floorY);
    // The course: split at every change of width, following the height.
    const end = COURSE_END_Z + 4;
    const boundaries = [COURSE.lobbyEndZ, end];
    for (const area of WIDE_AREAS) boundaries.push(area.minZ, area.maxZ);
    const marks = [...new Set(boundaries)].filter((z) => z >= COURSE.lobbyEndZ && z <= end).sort((a, b) => a - b);
    for (let i = 0; i < marks.length - 1; i += 1) {
      const fromZ = marks[i] as number;
      const toZ = marks[i + 1] as number;
      if (toZ - fromZ < 0.01) continue;
      const halfWidth = corridorHalfWidthAt((fromZ + toZ) / 2);
      run(halfWidth, fromZ, toZ, (z) => courseHeightAt(z));
    }

    // The hub's back rail.
    for (let x = -COURSE.lobbyHalfWidth + 4; x < COURSE.lobbyHalfWidth; x += 8) {
      const post = texturedBox(0.9, COURSE.wallHeight, 0.9, TILE);
      post.translate(x, COURSE.floorY + COURSE.wallHeight / 2, COURSE.lobbyStartZ + 0.9);
      posts.push(post);
      const rail = texturedBox(8, 0.5, 0.5, TILE);
      rail.translate(x + 4, COURSE.floorY + COURSE.wallHeight - 0.25, COURSE.lobbyStartZ + 0.9);
      rails.push(rail);
    }

    const stone = this.texturedMaterial(this.textures.column(PALETTE.column, PALETTE.columnShade, PALETTE.columnFlute));
    this.addMerged(posts, stone, true);
    this.addMerged(rails, stone, true);
    for (const [color, parts] of caps) this.addMerged(parts, this.emissiveMaterial(color, 0.35), false);
  }

  /**
   * The scenery: columns, clouds, braziers, arches, statues, gems, trees and
   * banners. All boxes and a few primitives, merged per material.
   */
  private buildDecorations(): void {
    const stone: BufferGeometry[] = [];
    const gold: BufferGeometry[] = [];
    const clouds: BufferGeometry[] = [];
    const cloudShade: BufferGeometry[] = [];
    const flames = new Map<number, BufferGeometry[]>();
    const trunks: BufferGeometry[] = [];
    const canopies: BufferGeometry[] = [];
    const banners = new Map<number, BufferGeometry[]>();

    for (const decoration of DECORATIONS) {
      const { x, y, z, scale, rotationY } = decoration;
      const accent = decoration.stage > 0 ? accentForStage(decoration.stage) : PALETTE.gold;

      switch (decoration.kind) {
        case 'column': {
          // A fluted shaft with a base and a gold capital.
          const height = 12 * scale;
          const shaft = new CylinderGeometry(0.9 * scale, 1.05 * scale, height, 10);
          shaft.translate(x, y + height / 2 + 0.6 * scale, z);
          stone.push(shaft);
          const base = texturedBox(2.6 * scale, 0.6 * scale, 2.6 * scale, TILE);
          base.translate(x, y + 0.3 * scale, z);
          stone.push(base);
          const capital = texturedBox(2.4 * scale, 0.7 * scale, 2.4 * scale, TILE);
          capital.translate(x, y + height + 0.95 * scale, z);
          gold.push(capital);
          break;
        }
        case 'cloud': {
          // A soft bank: stacked boxes, lit top and shaded base.
          const s = 7 * scale;
          const parts = [
            { w: 2.4, h: 0.9, d: 1.6, dx: 0, dy: 0.45 },
            { w: 1.6, h: 0.9, d: 1.2, dx: -0.9, dy: 0.95 },
            { w: 1.4, h: 0.8, d: 1.1, dx: 0.9, dy: 0.85 },
            { w: 1.0, h: 0.7, d: 0.9, dx: 0.1, dy: 1.35 },
          ];
          for (const part of parts) {
            const box = new BoxGeometry(part.w * s, part.h * s, part.d * s);
            box.translate(x + part.dx * s, y + part.dy * s, z);
            clouds.push(box);
          }
          const under = new BoxGeometry(2.6 * s, 0.3 * s, 1.7 * s);
          under.translate(x, y - 0.1 * s, z);
          cloudShade.push(under);
          break;
        }
        case 'brazier': {
          // A gold bowl on a stem, with a divine flame in it.
          const stem = new CylinderGeometry(0.35 * scale, 0.6 * scale, 2.6 * scale, 8);
          stem.translate(x, y + 1.3 * scale, z);
          gold.push(stem);
          const bowl = new CylinderGeometry(1.3 * scale, 0.7 * scale, 0.9 * scale, 10);
          bowl.translate(x, y + 3.0 * scale, z);
          gold.push(bowl);
          const flame = new OctahedronGeometry(0.9 * scale, 0);
          flame.scale(1, 1.8, 1);
          flame.translate(x, y + 4.4 * scale, z);
          bucket(flames, accent).push(flame);
          break;
        }
        case 'arch': {
          // THE GOLDEN GATE: two tall columns, a lintel and a ring of light.
          const height = 18 * scale;
          for (const side of [-1, 1]) {
            const shaft = new CylinderGeometry(1.6 * scale, 1.9 * scale, height, 12);
            shaft.translate(x + side * (COURSE.halfWidth + 3) * scale, y + height / 2, z);
            stone.push(shaft);
            const capital = texturedBox(4.4 * scale, 1.2 * scale, 4.4 * scale, TILE);
            capital.translate(x + side * (COURSE.halfWidth + 3) * scale, y + height + 0.6 * scale, z);
            gold.push(capital);
          }
          const lintel = texturedBox((COURSE.halfWidth * 2 + 10) * scale, 2.2 * scale, 3.4 * scale, TILE);
          lintel.translate(x, y + height + 2.3 * scale, z);
          gold.push(lintel);
          const ring = new TorusGeometry(7 * scale, 0.5 * scale, 8, 32);
          ring.translate(x, y + height + 2.3 * scale, z);
          bucket(flames, PALETTE.energy).push(ring);
          break;
        }
        case 'statue': {
          // A stylised gold figure on a marble plinth: legs, torso, head, a
          // raised arm holding a bolt.
          const s = scale;
          const plinth = texturedBox(3.2 * s, 1.2 * s, 3.2 * s, TILE);
          plinth.translate(x, y + 0.6 * s, z);
          stone.push(plinth);
          const parts: readonly (readonly [number, number, number, number, number, number])[] = [
            [0.7, 2.6, 0.7, -0.45, 2.5, 0],
            [0.7, 2.6, 0.7, 0.45, 2.5, 0],
            [2.0, 2.6, 1.0, 0, 5.1, 0],
            [1.0, 1.0, 1.0, 0, 6.9, 0],
            [0.5, 2.6, 0.5, 1.3, 6.4, 0],
            [0.3, 2.6, 0.3, 1.3, 8.4, 0],
          ];
          const cos = Math.cos(rotationY);
          const sin = Math.sin(rotationY);
          for (const [w, h, d, dx, dy, dz] of parts) {
            const box = new BoxGeometry(w * s, h * s, d * s);
            box.rotateY(rotationY);
            box.translate(x + (dx * cos + dz * sin) * s, y + dy * s, z + (-dx * sin + dz * cos) * s);
            gold.push(box);
          }
          break;
        }
        case 'gem': {
          const gem = new OctahedronGeometry(1.2 * scale, 0);
          gem.scale(1, 1.6, 1);
          gem.translate(x, y, z);
          const mesh = new Mesh(gem, this.emissiveMaterial(accent, 0.9));
          this.root.add(mesh);
          this.gems.push(mesh);
          break;
        }
        case 'tree': {
          const trunk = new CylinderGeometry(0.4 * scale, 0.6 * scale, 4 * scale, 7);
          trunk.translate(x, y + 2 * scale, z);
          trunks.push(trunk);
          for (const [dx, dy, dz, r] of [[0, 5, 0, 2.4], [1.4, 4.2, 0.6, 1.6], [-1.3, 4.4, -0.5, 1.7]] as const) {
            const blob = new SphereGeometry(r * scale, 8, 6);
            blob.translate(x + dx * scale, y + dy * scale, z + dz * scale);
            canopies.push(blob);
          }
          break;
        }
        case 'banner': {
          const cloth = new PlaneGeometry(3 * scale, 7 * scale);
          cloth.rotateY(rotationY);
          cloth.translate(x, y + 6 * scale, z);
          bucket(banners, accent).push(cloth);
          break;
        }
      }
    }

    const stoneMaterial = this.texturedMaterial(this.textures.column(PALETTE.column, PALETTE.columnShade, PALETTE.columnFlute));
    this.addMerged(stone, stoneMaterial, true);
    this.addMerged(gold, this.solidMaterial(PALETTE.statueGold, 0.12), true);
    this.addMerged(clouds, this.cloudMaterial(0xffffff), false);
    this.addMerged(cloudShade, this.cloudMaterial(0xdbe9f7), false);
    this.addMerged(trunks, this.solidMaterial(PALETTE.trunk), true);
    this.addMerged(canopies, this.solidMaterial(PALETTE.canopy), true);
    for (const [color, parts] of flames) this.addMerged(parts, this.emissiveMaterial(color, 0.95), false);
    for (const [color, parts] of banners) {
      const material = new MeshLambertMaterial({ color, side: DoubleSide });
      this.materials.push(material);
      this.addMerged(parts, material, false);
    }
  }

  /** The game's title, floating over the golden gate. */
  private buildTitle(): void {
    const sign = new CanvasSign(60, 14, [
      { text: 'GODSPEED ESCAPE', size: 1, fill: '#ffe08a', stroke: '#2a1a05', strokeWidth: 0.16 },
      { text: 'Sprint with the power of the gods', size: 0.42, fill: '#ffffff', stroke: '#1c2233', strokeWidth: 0.14 },
    ]);
    sign.mesh.position.set(0, COURSE.floorY + 30, COURSE.lobbyEndZ - 3);
    sign.mesh.rotation.y = Math.PI;
    this.root.add(sign.mesh);
    this.materials.push(sign.mesh.material as Material);
  }

  private buildWinPadSigns(): void {
    this.winReveal = new StageReveal(this.root, (stage) => {
      const sign = new CanvasSign(12, 5, [
        { text: `+${formatWins(stage.winReward)} Wins`, size: 1, fill: '#ffc51f', stroke: '#231502', strokeWidth: 0.17 },
        { text: 'Return', size: 0.58, fill: '#ffffff', stroke: '#231502', strokeWidth: 0.15 },
      ]);
      sign.mesh.position.set(stage.winPadX, stage.padY + 5.4, stage.winPadZ);
      sign.mesh.rotation.y = Math.PI;
      return sign;
    });

    const slabs: BufferGeometry[] = [];
    const halos: BufferGeometry[] = [];
    for (const stage of STAGES) {
      const slab = texturedBox(WIN_PAD.width + PLINTH.margin * 2, PLINTH.height, WIN_PAD.length + PLINTH.margin * 2, TILE);
      slab.translate(stage.winPadX, stage.endY + PLINTH.height / 2 - 0.02, stage.winPadZ);
      slabs.push(slab);
      const halo = texturedBox(WIN_PAD.width + 6, 0.12, WIN_PAD.length + 6, TILE);
      halo.translate(stage.winPadX, stage.padY + 0.14, stage.winPadZ);
      halos.push(halo);
    }
    this.addMerged(slabs, this.solidMaterial(PALETTE.winPadRim), true);

    const haloMaterial = new MeshLambertMaterial({
      color: 0xffc94a,
      transparent: true,
      opacity: WIN_GLOW.haloBase,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    haloMaterial.emissive.setHex(0xffb01a);
    haloMaterial.emissiveIntensity = 1;
    this.materials.push(haloMaterial);
    this.winHaloMaterial = haloMaterial;
    this.addMerged(halos, haloMaterial, false);

    this.buildWinPadCups();
  }

  private buildWinPadCups(): void {
    const texture = loadSharedImage(TROPHY_URL);
    const build = (): void => {
      const image = texture.image as { width?: number; height?: number } | null;
      const width = image?.width ?? 0;
      const height = image?.height ?? 0;
      if (width <= 0 || height <= 0) return;

      const quads: BufferGeometry[] = [];
      for (const stage of STAGES) {
        for (const cup of CUPS) {
          const tall = CUP_HEIGHT * cup.scale;
          const quad = new PlaneGeometry(tall * (width / height), tall);
          quad.rotateY(Math.PI);
          quad.translate(
            stage.winPadX + cup.x * (WIN_PAD.width / 2),
            stage.padY + tall / 2 + cup.lift,
            stage.winPadZ + cup.z * (WIN_PAD.length / 2),
          );
          quads.push(quad);
        }
      }
      const material = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.5, side: DoubleSide, fog: false });
      this.materials.push(material);
      const merged = mergeGeometries(quads, false);
      for (const quad of quads) quad.dispose();
      if (!merged) return;
      this.cupMesh = new Mesh(merged, material);
      this.root.add(this.cupMesh);
    };
    const image = texture.image as { width?: number } | null;
    if (image?.width) build();
    else onImageDecoded(texture, build);
  }

  private pulse(delta: number): void {
    this.glowTime += delta;
    const breath = (Math.sin(this.glowTime * WIN_GLOW.rate) + 1) / 2;
    if (this.winPadMaterial) this.winPadMaterial.emissiveIntensity = WIN_GLOW.base + breath * WIN_GLOW.swing;
    if (this.winHaloMaterial) this.winHaloMaterial.opacity = WIN_GLOW.haloBase + breath * WIN_GLOW.haloSwing;
    if (this.launchMaterial) this.launchMaterial.emissiveIntensity = 0.6 + breath * 0.5;
    if (this.cupMesh) this.cupMesh.position.y = Math.sin(this.glowTime * WIN_GLOW.rate) * 0.25;
    for (let i = 0; i < this.gems.length; i += 1) {
      const gem = this.gems[i];
      if (!gem) continue;
      gem.rotation.y = this.glowTime * 1.2 + i;
      gem.position.y += Math.sin(this.glowTime * 2 + i) * 0.004;
    }
  }

  private addMerged(geometries: BufferGeometry[], material: Material, receiveShadow: boolean): void {
    if (geometries.length === 0) return;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return;
    const mesh = new Mesh(merged, material);
    mesh.receiveShadow = receiveShadow;
    this.root.add(mesh);
  }

  private materialFor(kind: SolidKind): Material {
    switch (kind) {
      case 'floor':
      case 'island':
      case 'bridge':
        return this.texturedMaterial(this.textures.marble(PALETTE.marble, PALETTE.marbleVein, PALETTE.marbleInlay));
      case 'lobby':
        return this.texturedMaterial(this.textures.marble(PALETTE.lobbyMarble, PALETTE.marbleVein, PALETTE.lobbyInlay));
      case 'deck':
      case 'stair':
      case 'block':
      case 'pillar':
      case 'wall':
        return this.texturedMaterial(this.textures.column(PALETTE.column, PALETTE.columnShade, PALETTE.columnFlute));
      case 'cloud':
        return this.cloudMaterial(0xffffff, this.textures.cloud(PALETTE.cloud, PALETTE.cloudShade));
      case 'ice':
        return this.texturedMaterial(this.textures.ice(PALETTE.ice, PALETTE.iceBright));
      case 'tile':
        return this.solidMaterial(PALETTE.tileBase);
      case 'launch': {
        const material = new MeshLambertMaterial({ color: PALETTE.energy });
        material.emissive.setHex(PALETTE.energy);
        material.emissiveIntensity = 0.8;
        this.materials.push(material);
        this.launchMaterial = material;
        return material;
      }
      case 'winPad': {
        const material = new MeshLambertMaterial({ map: this.textures.winPlate(PALETTE.winPad, PALETTE.winPadAlt) });
        material.emissive.setHex(0xffb01a);
        material.emissiveIntensity = WIN_GLOW.base;
        this.materials.push(material);
        this.winPadMaterial = material;
        return material;
      }
      case 'sinking':
      default:
        return this.solidMaterial(0xffffff);
    }
  }

  private cloudMaterial(color: number, map?: Texture): Material {
    const material = new MeshLambertMaterial(map ? { map, color } : { color });
    material.emissive.setHex(0xffffff);
    material.emissiveIntensity = 0.12;
    this.materials.push(material);
    return material;
  }

  private texturedMaterial(map: Texture): Material {
    const material = new MeshLambertMaterial({ map });
    this.materials.push(material);
    return material;
  }

  private emissiveMaterial(color: number, intensity: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    material.emissive.setHex(color);
    material.emissiveIntensity = intensity;
    this.materials.push(material);
    return material;
  }

  private solidMaterial(color: number, emissive = 0): Material {
    const material = new MeshLambertMaterial({ color });
    if (emissive > 0) {
      material.emissive.setHex(color);
      material.emissiveIntensity = emissive;
    }
    this.materials.push(material);
    return material;
  }
}

const boxFor = (solid: CourseSolid, tile: number): BufferGeometry => {
  const geometry = texturedBox(solid.maxX - solid.minX, solid.maxY - solid.minY, solid.maxZ - solid.minZ, tile);
  geometry.translate((solid.minX + solid.maxX) / 2, (solid.minY + solid.maxY) / 2, (solid.minZ + solid.maxZ) / 2);
  return geometry;
};

export { STAGES, UPGRADE_ROWS };
