import { Group } from 'three';
import { CanvasSign } from './CanvasSign.js';
import type { SignLine } from './CanvasSign.js';
import { StageReveal } from './StageReveal.js';

/**
 * The stage indicator at the head of each stage: "STAGE N", its name, and the
 * recommended level, as the reference has it ("Stage 1 / Recommended Level:
 * 0"). Floating text, no panel, hung high and facing back down the course at
 * the player approaching. Built as the player reaches it.
 */
export class StageSigns {
  readonly root = new Group();

  private readonly reveal = new StageReveal(this.root, (stage) => {
    const lines: SignLine[] = [
      { text: `Stage ${stage.index}`, size: 1, fill: '#ffffff', stroke: '#1c2233', strokeWidth: 0.14 },
      { text: stage.name, size: 0.55, fill: '#ffe08a', stroke: '#2a1a05', strokeWidth: 0.14 },
      {
        text: `Recommended Level: ${stage.recommendedLevel}`,
        size: 0.42,
        fill: '#7fe6ff',
        stroke: '#0b2a3a',
        strokeWidth: 0.14,
      },
    ];
    const sign = new CanvasSign(30, 12, lines);
    sign.mesh.position.set(0, stage.startY + 16, stage.startZ + 12);
    sign.mesh.rotation.y = Math.PI;
    return sign;
  });

  revealNear(z: number): void {
    this.reveal.revealNear(z);
  }

  dispose(): void {
    this.reveal.dispose();
    this.root.removeFromParent();
  }
}
