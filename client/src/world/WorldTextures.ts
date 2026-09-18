import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Every texture in the game, drawn at runtime on a canvas.
 *
 * There is not one image file in this build's WORLD. Marble paving with a
 * gold inlay, fluted column stone, the gold plate, soft clouds, the cloud sea,
 * the treadmill belt and polished marble all cost a few kilobytes of code and
 * nothing against the 12 MB budget. Textures are cached and shared.
 */
export class WorldTextures {
  private readonly cache = new Map<string, Texture>();

  /**
   * MARBLE PAVING with a gold inlay line: the course floor and the hub.
   *
   * Large pale tiles with faint veins, a fine dark grout, and a gold line
   * inset in every tile - which is what says "Olympus" rather than "a white
   * floor", and gives the eye a grid to judge distance against.
   */
  marble(color: string, vein: string, inlay: string): Texture {
    return this.cached(`marble:${color}:${vein}:${inlay}`, () => {
      const size = 256;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      // Veins: a few soft diagonal strokes.
      const random = seeded(0x5a11);
      ctx.strokeStyle = vein;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 9; i += 1) {
        ctx.beginPath();
        const x = random() * size;
        const y = random() * size;
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 40, y + 20 * random(), x + 90, y - 30 * random(), x + 150, y + 10);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Grout: one tile per texture, so the tile is the repeat.
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 5;
      ctx.strokeRect(0, 0, size, size);

      // The gold inlay: a thin square inset from the tile edge.
      ctx.strokeStyle = inlay;
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(size * 0.11, size * 0.11, size * 0.78, size * 0.78);
      ctx.globalAlpha = 1;
      // A shading line under the inlay, so it reads as set INTO the stone.
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 2;
      ctx.strokeRect(size * 0.11 + 4, size * 0.11 + 4, size * 0.78 - 8, size * 0.78 - 8);
      return ctx.canvas;
    });
  }

  /** FLUTED STONE: columns, walls, the hub's decks. Vertical grooves in pale stone. */
  column(color: string, shade: string, flute: string): Texture {
    return this.cached(`column:${color}:${shade}:${flute}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      const flutes = 6;
      const pitch = size / flutes;
      for (let i = 0; i < flutes; i += 1) {
        const x = i * pitch;
        const gradient = ctx.createLinearGradient(x, 0, x + pitch, 0);
        gradient.addColorStop(0, shade);
        gradient.addColorStop(0.35, color);
        gradient.addColorStop(0.7, color);
        gradient.addColorStop(1, shade);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, 0, pitch, size);
        ctx.fillStyle = flute;
        ctx.fillRect(x, 0, 3, size);
      }
      // A block course line, so a wall has masonry in it.
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(0, size * 0.5, size, 3);
      return ctx.canvas;
    });
  }

  /** THE GOLD PLATE: flat gold with faint studs, the win pad. */
  winPlate(color: string, stud: string): Texture {
    return this.cached(`gold:${color}:${stud}`, () => {
      const size = 256;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      const cells = 4;
      const pitch = size / cells;
      const radius = pitch * 0.17;
      for (let ix = 0; ix < cells; ix += 1) {
        for (let iy = 0; iy < cells; iy += 1) {
          const cx = (ix + 0.5) * pitch;
          const cy = (iy + 0.5) * pitch;
          ctx.fillStyle = 'rgba(0,0,0,0.14)';
          ctx.beginPath();
          ctx.arc(cx, cy + radius * 0.4, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = stud;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      return ctx.canvas;
    });
  }

  /** A CHEQUER of two colours: the return pad. */
  check(color: string, alt: string): Texture {
    return this.cached(`check:${color}:${alt}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = alt;
      ctx.fillRect(0, 0, size / 2, size / 2);
      ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, size, size);
      return ctx.canvas;
    });
  }

  /** A SOFT CLOUD: white with paler billows, for the walkable clouds. */
  cloud(color: string, shade: string): Texture {
    return this.cached(`cloud:${color}:${shade}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, size, size);
      const random = seeded(0xc10d);
      for (let i = 0; i < 26; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 14 + random() * 22;
        const gradient = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, `${shade}00`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // Wrap the blob across the seam.
        for (const [dx, dy] of [[size, 0], [-size, 0], [0, size], [0, -size]] as const) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return ctx.canvas;
    });
  }

  /** THE CLOUD SEA under the platforms: billows in a haze. */
  sea(color: string, shade: string): Texture {
    return this.cached(`sea:${color}:${shade}`, () => {
      const size = 256;
      const ctx = context(size);
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, size, size);
      const random = seeded(0x5ea);
      for (let i = 0; i < 40; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 20 + random() * 40;
        const gradient = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, `${shade}00`);
        ctx.fillStyle = gradient;
        for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return ctx.canvas;
    });
  }

  /** POLISHED MARBLE: almost featureless, one broad sheen. */
  ice(color: string, bright: string): Texture {
    return this.cached(`polish:${color}:${bright}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      const sheen = ctx.createLinearGradient(0, 0, size, size);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.45, bright);
      sheen.addColorStop(0.55, bright);
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, size, size);
      return ctx.canvas;
    });
  }

  /** TREADMILL BELT: travelling chevrons on dark rubber. The material scrolls it. */
  belt(base: string, mark: string): Texture {
    return this.cached(`belt:${base}:${mark}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = mark;
      ctx.lineWidth = 9;
      ctx.lineCap = 'butt';
      for (let i = -size; i < size * 2; i += 34) {
        ctx.beginPath();
        ctx.moveTo(i, size);
        ctx.lineTo(i + size / 2, size / 2);
        ctx.lineTo(i, 0);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, size, 5);
      ctx.fillRect(0, size - 5, size, 5);
      return ctx.canvas;
    });
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private cached(key: string, draw: () => HTMLCanvasElement, repeat = true): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const texture = new CanvasTexture(draw());
    texture.colorSpace = SRGBColorSpace;
    if (repeat) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
    }
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.cache.set(key, texture);
    return texture;
  }
}

const context = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
};

/** Deterministic PRNG, so every client draws exactly the same stone. */
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
