import { formatWins } from '@godspeed/shared';
import { ICONS, injectHudStyles } from './hudStyles.js';

/**
 * The Wins total, top centre: a trophy and "Wins: N" in outlined yellow, as
 * the reference frames it. Replicated server state; it pops when the total
 * RISES.
 */
export class WinsCounter {
  private readonly root: HTMLDivElement;
  private readonly value: HTMLDivElement;
  private last = -1;
  private popTimer = 0;

  constructor(parent: HTMLElement) {
    injectHudStyles();

    this.root = document.createElement('div');
    this.root.className = 'aoe-wins aoe-font';

    const icon = document.createElement('div');
    icon.className = 'aoe-wins__icon';
    icon.innerHTML = ICONS.trophy;

    this.value = document.createElement('div');
    this.value.className = 'aoe-wins__value aoe-outline';
    this.value.textContent = 'Wins: 0';

    this.root.append(icon, this.value);
    parent.appendChild(this.root);
  }

  update(wins: number): void {
    if (wins === this.last) return;
    const rose = wins > this.last && this.last >= 0;
    this.last = wins;
    this.value.textContent = `Wins: ${formatWins(wins)}`;

    if (!rose) return;
    this.root.classList.remove('aoe-wins--pop');
    void this.root.offsetWidth;
    this.root.classList.add('aoe-wins--pop');
    window.clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.root.classList.remove('aoe-wins--pop'), 560);
  }

  dispose(): void {
    window.clearTimeout(this.popTimer);
    this.root.remove();
  }
}
