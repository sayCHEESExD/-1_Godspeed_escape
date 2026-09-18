import {
  SPEED_UPGRADES,
  UPGRADE_ROWS,
  formatStep,
  formatWins,
  ownsUpgrade,
  upgradeTileX,
  upgradeTileY,
  upgradeTileZ,
} from '@godspeed/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { PowerPreviews } from './PowerPreviews.js';

/** One tile's dressing: what changes with the player's inventory. */
interface Tile {
  readonly slot: number;
  readonly face: Mesh;
  readonly beam: Mesh;
  readonly beamMaterial: MeshBasicMaterial;
}

/**
 * THE SPEED UPGRADE TERRACES, down the player's LEFT.
 *
 * Fifteen tiles in three stepped rows. Each tile carries its tier's GOD
 * POWER colour as a lit face and a column of light rising from it, and a
 * live miniature of the power itself standing on the tile (`PowerPreviews`),
 * so the row reads as fifteen powers on display rather than fifteen grey
 * pads - and a floating sign over each says "Speed +N" and what it requires,
 * exactly as the reference art has them.
 *
 * Three states, decided by REPLICATED state and nothing else: OWNED (green
 * face, the beam burns steady), UNLOCKABLE (the face and beam pulse, so a
 * player can see from the spawn which tile is waiting for them) and LOCKED
 * (a dim red face, a faint beam).
 */
export class UpgradeTerraces {
  readonly root = new Group();

  private readonly tiles: Tile[] = [];
  private readonly previews = new PowerPreviews();
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: (MeshLambertMaterial | MeshBasicMaterial)[] = [];

  private readonly owned: MeshLambertMaterial;
  private readonly ready: MeshLambertMaterial;
  private readonly locked: MeshLambertMaterial;

  private ownedMask = 0;
  private wins = 0;
  private time = 0;

  constructor() {
    this.owned = this.lambert(0x5ed64f, 0.35);
    this.ready = this.lambert(PALETTE.tileGlow, 0.7);
    this.locked = this.lambert(0xd9534f, 0.12);

    const size = UPGRADE_ROWS.tileSize;
    const faceGeometry = new BoxGeometry(size - 1.2, 0.14, size - 1.2);
    const beamGeometry = new CylinderGeometry(1.1, 1.6, 7, 12, 1, true);
    this.geometries.push(faceGeometry, beamGeometry);

    for (const tier of SPEED_UPGRADES) {
      const x = upgradeTileX(tier.slot);
      const y = upgradeTileY(tier.slot) + UPGRADE_ROWS.tileHeight;
      const z = upgradeTileZ(tier.slot);

      // The lit face, just proud of the tile's top.
      const face = new Mesh(faceGeometry, this.locked);
      face.position.set(x, y + 0.08, z);
      face.receiveShadow = true;
      this.root.add(face);

      // The column of light in the tier's own colour.
      const beamMaterial = new MeshBasicMaterial({
        color: tier.power.color,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      this.materials.push(beamMaterial);
      const beam = new Mesh(beamGeometry, beamMaterial);
      beam.position.set(x, y + 3.5, z);
      this.root.add(beam);

      // The sign: "Speed +N" in gold, and the requirement under it. Faces the
      // spawn, which is -X from the terraces.
      const requirement = tier.winsRequired === 0 ? 'FREE' : `${formatWins(tier.winsRequired)} Wins required`;
      const sign = new CanvasSign(9, 3.6, [
        { text: `Speed +${formatStep(tier.speedPerStep)}`, size: 1, fill: '#ffe08a', stroke: '#2a1a05', strokeWidth: 0.16 },
        {
          text: requirement,
          size: 0.62,
          fill: tier.winsRequired === 0 ? '#9dff8a' : '#ffffff',
          stroke: '#1c2233',
          strokeWidth: 0.15,
        },
      ]);
      sign.mesh.position.set(x, y + 8.6, z);
      sign.mesh.rotation.y = -Math.PI / 2;
      this.root.add(sign.mesh);
      this.signs.push(sign);

      this.tiles.push({ slot: tier.slot, face, beam, beamMaterial });
    }

    // The area's title, over the middle of the top row.
    const title = new CanvasSign(26, 6, [
      { text: 'SPEED UPGRADES', size: 1, fill: '#ffffff', stroke: '#1c2233', strokeWidth: 0.16 },
      { text: 'Walk onto a tile to unlock it', size: 0.5, fill: '#ffe08a', stroke: '#2a1a05', strokeWidth: 0.14 },
    ]);
    title.mesh.position.set(UPGRADE_ROWS.rowX[2] + 4, UPGRADE_ROWS.rowY[2] + 15, UPGRADE_ROWS.firstZ + UPGRADE_ROWS.spacingZ * 2);
    title.mesh.rotation.y = -Math.PI / 2;
    this.root.add(title.mesh);
    this.signs.push(title);

    // The powers themselves, one on every tile, locked or not.
    this.root.add(this.previews.root);

    this.apply();
  }

  /** Mirror the replicated inventory and wallet. */
  setInventory(ownedMask: number, wins: number): void {
    if (ownedMask === this.ownedMask && wins === this.wins) return;
    this.ownedMask = ownedMask;
    this.wins = wins;
    this.apply();
  }

  /** @param viewerX, viewerZ  the local player, so the previews can sleep when far */
  update(delta: number, viewerX: number, viewerZ: number): void {
    this.time += delta;
    this.previews.update(delta, viewerX, viewerZ);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 4);
    for (const tile of this.tiles) {
      const tier = SPEED_UPGRADES[tile.slot - 1];
      if (!tier) continue;
      const owned = ownsUpgrade(this.ownedMask, tile.slot);
      const ready = !owned && this.wins >= tier.winsRequired;
      tile.beamMaterial.opacity = owned ? 0.26 : ready ? 0.14 + pulse * 0.3 : 0.07;
      tile.beam.rotation.y = this.time * 0.8;
      if (ready) this.ready.emissiveIntensity = 0.4 + pulse * 0.6;
    }
  }

  private apply(): void {
    for (const tile of this.tiles) {
      const tier = SPEED_UPGRADES[tile.slot - 1];
      if (!tier) continue;
      const owned = ownsUpgrade(this.ownedMask, tile.slot);
      const ready = !owned && this.wins >= tier.winsRequired;
      tile.face.material = owned ? this.owned : ready ? this.ready : this.locked;
    }
  }

  private lambert(color: number, emissive: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    material.emissive.setHex(color);
    material.emissiveIntensity = emissive;
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    this.previews.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const sign of this.signs) sign.dispose();
    this.root.removeFromParent();
  }
}
