import {
  MAX_LEVEL,
  canRebirth,
  rebirthMultiplier,
  rebirthRequiredLevel,
} from '@godspeed/shared';
import { ICONS } from './hudStyles.js';
import { Panel } from './Panel.js';

/**
 * The rebirth confirmation, laid out as the reference frames it: BEFORE and
 * AFTER columns, a Speed multiplier row and a Max Level row, the level bar
 * against the requirement, and ONE Rebirth button. There is no skip.
 *
 * The button only ever ASKS. Eligibility is decided by the server; this
 * panel mirrors the replicated figures.
 */
export class RebirthPanel extends Panel {
  private readonly beforeSpeed: HTMLSpanElement;
  private readonly afterSpeed: HTMLSpanElement;
  private readonly beforeLevel: HTMLSpanElement;
  private readonly afterLevel: HTMLSpanElement;
  private readonly barFill: HTMLDivElement;
  private readonly barLevel: HTMLSpanElement;
  private readonly barCount: HTMLSpanElement;
  private readonly action: HTMLButtonElement;

  private level = 1;
  private rebirths = 0;

  constructor(parent: HTMLElement, onRebirth: () => void) {
    super(parent, 'rebirth', 'Rebirth', ICONS.rebirth);

    const heads = document.createElement('div');
    heads.className = 'aoe-rb__heads aoe-font';
    heads.innerHTML = '<span>Before</span><span></span><span>After</span>';

    const grid = document.createElement('div');
    grid.className = 'aoe-rb';
    const speedRow = this.row(grid, 'speed');
    const levelRow = this.row(grid, 'level');
    this.beforeSpeed = speedRow[0];
    this.afterSpeed = speedRow[1];
    this.beforeLevel = levelRow[0];
    this.afterLevel = levelRow[1];

    const bar = document.createElement('div');
    bar.className = 'aoe-rb__bar';
    this.barFill = document.createElement('div');
    this.barFill.className = 'aoe-rb__fill';
    const label = document.createElement('div');
    label.className = 'aoe-rb__barlabel aoe-font';
    this.barLevel = document.createElement('span');
    this.barLevel.className = 'aoe-outline';
    this.barCount = document.createElement('span');
    this.barCount.className = 'aoe-outline';
    label.append(this.barLevel, this.barCount);
    bar.append(this.barFill, label);

    const warning = document.createElement('p');
    warning.className = 'aoe-rb__warn aoe-font';
    warning.textContent = 'Rebirth resets your level and Speed. Wins, upgrades and cosmetics are kept.';

    this.action = document.createElement('button');
    this.action.type = 'button';
    this.action.className = 'aoe-action aoe-rb__go aoe-font';
    this.action.textContent = 'Rebirth';
    this.action.addEventListener('click', () => {
      if (this.action.disabled) return;
      onRebirth();
      this.setOpen(false);
    });

    this.body.append(heads, grid, bar, warning, this.action);
    this.render();
  }

  setProgress(level: number, rebirths: number): void {
    if (level === this.level && rebirths === this.rebirths) return;
    this.level = level;
    this.rebirths = rebirths;
    this.render();
  }

  get isEligible(): boolean {
    return canRebirth(this.level, this.rebirths);
  }

  protected override onOpened(): void {
    this.render();
  }

  private row(grid: HTMLDivElement, variant: string): [HTMLSpanElement, HTMLSpanElement] {
    const card = (): HTMLSpanElement => {
      const box = document.createElement('div');
      box.className = `aoe-rb__card aoe-rb__card--${variant}`;
      const mark = document.createElement('span');
      mark.innerHTML = variant === 'speed' ? ICONS.shoe : ICONS.trophy;
      const value = document.createElement('span');
      value.className = 'aoe-font aoe-outline';
      box.append(mark, value);
      grid.appendChild(box);
      return value;
    };
    const before = card();
    const arrow = document.createElement('span');
    arrow.className = 'aoe-rb__arrow aoe-font aoe-outline';
    arrow.textContent = '>';
    grid.appendChild(arrow);
    return [before, card()];
  }

  private render(): void {
    const required = rebirthRequiredLevel(this.rebirths);
    const eligible = this.isEligible;

    this.beforeSpeed.textContent = `Speed x${rebirthMultiplier(this.rebirths).toFixed(1)}`;
    this.afterSpeed.textContent = `Speed x${rebirthMultiplier(this.rebirths + 1).toFixed(1)}`;
    this.beforeLevel.textContent = `Max Level ${MAX_LEVEL}`;
    this.afterLevel.textContent = `Max Level ${MAX_LEVEL}`;

    const shown = Math.min(this.level, required);
    this.barFill.style.width = `${Math.min(Math.max(shown / required, 0), 1) * 100}%`;
    this.barLevel.textContent = `Level ${this.level}`;
    this.barCount.textContent = `${shown}/${required}`;

    this.action.disabled = !eligible;
    this.action.textContent = eligible ? 'Rebirth' : `Reach Level ${required}`;
  }
}
