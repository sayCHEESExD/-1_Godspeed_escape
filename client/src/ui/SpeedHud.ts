import { formatSpeed, formatStep, resolveLevel, type LevelProgress } from '@godspeed/shared';

/**
 * THE BOTTOM-CENTRE READOUT, as the reference frames it, top to bottom:
 *
 *      6 km/h
 *   [ Sprint (Q)            👟 ]   <- the sprint energy bar
 *          5771 Speed
 *   [ Level 21 ][ 226/544        ]
 *
 * THE SPRINT BAR IS THE THING A PLAYER HAS TO UNDERSTAND AT A GLANCE: an
 * orange bar that DRAINS from the right while Q is held and refills when it
 * is released. It is drawn from the client's prediction so it moves the frame
 * the key goes down. Everything else shows SERVER state.
 */
export class SpeedHud {
  private readonly root: HTMLDivElement;
  private readonly kmh: HTMLDivElement;
  private readonly sprintBar: HTMLDivElement;
  private readonly sprintFill: HTMLDivElement;
  private readonly speedValue: HTMLDivElement;
  private readonly rateValue: HTMLSpanElement;
  private readonly levelChip: HTMLDivElement;
  private readonly levelFill: HTMLDivElement;
  private readonly levelLabel: HTMLDivElement;

  private lastTotal = -1;
  private lastLevel = -1;
  private lastRate = -1;
  private lastKmh = -1;
  private lastFraction = -1;
  private lastSprinting: boolean | null = null;
  private lastLocked: boolean | null = null;

  constructor(parent: HTMLElement) {
    injectStyles();

    this.root = el('div', 'gs-hud');

    this.kmh = el('div', 'gs-hud__kmh aoe-font aoe-outline');
    this.kmh.textContent = '0 km/h';

    this.sprintBar = el('div', 'gs-hud__sprint');
    this.sprintFill = el('div', 'gs-hud__sprint-fill');
    const sprintLabel = el('div', 'gs-hud__sprint-label aoe-font aoe-outline');
    sprintLabel.textContent = 'Sprint (Q)';
    const sprintIcon = el('div', 'gs-hud__sprint-icon');
    sprintIcon.innerHTML = '<img class="aoe-icon" src="/ui/shoe.png" alt="" draggable="false">';
    this.sprintBar.append(this.sprintFill, sprintLabel, sprintIcon);

    this.speedValue = el('div', 'gs-hud__speed aoe-font aoe-outline aoe-outline--big');
    this.speedValue.textContent = '0 Speed';

    const rate = el('div', 'gs-hud__rate aoe-font aoe-outline');
    this.rateValue = document.createElement('span');
    this.rateValue.textContent = '+1';
    rate.append(this.rateValue, document.createTextNode(' Speed per step'));

    const level = el('div', 'gs-hud__level');
    this.levelChip = el('div', 'gs-hud__level-chip aoe-font aoe-outline');
    this.levelChip.textContent = 'Level 1';
    const track = el('div', 'gs-hud__level-track');
    this.levelFill = el('div', 'gs-hud__level-fill');
    this.levelLabel = el('div', 'gs-hud__level-label aoe-font aoe-outline');
    this.levelLabel.textContent = '0/128';
    track.append(this.levelFill, this.levelLabel);
    level.append(this.levelChip, track);

    this.root.append(this.kmh, this.sprintBar, this.speedValue, rate, level);
    parent.appendChild(this.root);
  }

  /** The replicated progression. */
  updateProgress(totalSpeed: number, levelCap: number, speedPerStep: number): void {
    const progress = resolveLevel(totalSpeed, levelCap);
    if (totalSpeed !== this.lastTotal) {
      this.lastTotal = totalSpeed;
      this.speedValue.textContent = `${formatSpeed(totalSpeed)} Speed`;
      this.renderLevel(progress);
    }
    if (progress.level !== this.lastLevel) {
      const levelled = this.lastLevel >= 0;
      this.lastLevel = progress.level;
      this.levelChip.textContent = `Level ${progress.level}`;
      if (levelled) {
        this.root.classList.remove('gs-hud--levelled');
        void this.root.offsetWidth;
        this.root.classList.add('gs-hud--levelled');
      }
    }
    if (speedPerStep !== this.lastRate) {
      this.lastRate = speedPerStep;
      this.rateValue.textContent = `+${formatStep(speedPerStep)}`;
    }
  }

  /** The PREDICTED sprint bar. */
  updateSprint(fraction: number, sprinting: boolean, locked: boolean): void {
    const rounded = Math.round(fraction * 200) / 200;
    if (rounded !== this.lastFraction) {
      this.lastFraction = rounded;
      this.sprintFill.style.width = `${rounded * 100}%`;
    }
    if (sprinting !== this.lastSprinting) {
      this.lastSprinting = sprinting;
      this.sprintBar.classList.toggle('gs-hud__sprint--on', sprinting);
    }
    if (locked !== this.lastLocked) {
      this.lastLocked = locked;
      this.sprintBar.classList.toggle('gs-hud__sprint--locked', locked);
    }
  }

  updateSpeedometer(kmh: number): void {
    if (kmh === this.lastKmh) return;
    this.lastKmh = kmh;
    this.kmh.textContent = `${kmh} km/h`;
  }

  dispose(): void {
    this.root.remove();
  }

  private renderLevel(progress: LevelProgress): void {
    this.levelFill.style.width = `${(progress.capped ? 1 : progress.fraction) * 100}%`;
    this.levelLabel.textContent = progress.capped
      ? 'MAX'
      : `${formatSpeed(Math.floor(progress.into))}/${formatSpeed(progress.required)}`;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.gs-hud {
  position: fixed;
  left: 50%;
  bottom: 2.4vh;
  transform: translateX(-50%);
  width: min(560px, 78vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  user-select: none;
  z-index: 20;
  font-family: var(--gs-font);
}
.gs-hud__kmh { font-size: clamp(14px, 1.6vw, 20px); color: #7fe6ff; }

/* THE SPRINT BAR. Orange, chunky, and it visibly drains. */
.gs-hud__sprint {
  position: relative;
  width: min(420px, 72vw);
  height: clamp(34px, 4.2vw, 48px);
  border: 4px solid var(--gs-ink);
  border-radius: 12px;
  background: #5a4420;
  overflow: hidden;
  box-shadow: 0 5px 0 rgba(0, 0, 0, 0.3);
}
.gs-hud__sprint-fill {
  position: absolute;
  inset: 0;
  width: 100%;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 6px, transparent 6px 14px),
    linear-gradient(180deg, #ffc23d, #ff9a1f);
  transition: width 60ms linear;
}
.gs-hud__sprint-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: clamp(16px, 2vw, 24px);
}
.gs-hud__sprint-icon {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  height: 80%;
}
.gs-hud__sprint-icon .aoe-icon { height: 100%; width: auto; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.4)); }
.gs-hud__sprint--on { box-shadow: 0 0 22px rgba(255, 190, 40, 0.9), 0 5px 0 rgba(0, 0, 0, 0.3); }
.gs-hud__sprint--on .gs-hud__sprint-fill { filter: brightness(1.15); }
.gs-hud__sprint--locked .gs-hud__sprint-fill { filter: saturate(0.4) brightness(0.8); }

.gs-hud__speed { font-size: clamp(26px, 3.6vw, 44px); line-height: 1; }
.gs-hud__rate { font-size: clamp(12px, 1.3vw, 16px); color: #b9ffb0; margin-top: -2px; }

.gs-hud__level {
  display: flex;
  width: 100%;
  height: clamp(36px, 4.4vw, 50px);
  border: 4px solid var(--gs-ink);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 5px 0 rgba(0, 0, 0, 0.3);
}
.gs-hud__level-chip {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 0 clamp(12px, 2vw, 22px);
  background: linear-gradient(180deg, #5ee0ff, #1fa8e8);
  border-right: 4px solid var(--gs-ink);
  font-size: clamp(16px, 2vw, 24px);
}
.gs-hud__level-track { position: relative; flex: 1 1 auto; background: #e9e9e9; }
.gs-hud__level-fill { position: absolute; inset: 0; width: 0; background: linear-gradient(180deg, #ffffff, #cfd8e6); transition: width 160ms ease-out; }
.gs-hud__level-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 14px;
  font-size: clamp(16px, 2vw, 24px);
}
.gs-hud--levelled .gs-hud__level { animation: gs-levelled 620ms ease-out; }
@keyframes gs-levelled {
  0% { box-shadow: 0 0 0 0 rgba(94, 224, 255, 0.9), 0 5px 0 rgba(0,0,0,0.3); }
  60% { box-shadow: 0 0 0 14px rgba(94, 224, 255, 0), 0 5px 0 rgba(0,0,0,0.3); }
  100% { box-shadow: 0 0 0 0 rgba(94, 224, 255, 0), 0 5px 0 rgba(0,0,0,0.3); }
}

/* Touch controls own the bottom corners; the block lifts clear of them. */
body.aoe-touch-mode .gs-hud { bottom: calc(2.4vh + 132px); width: min(480px, 86vw); }
@media (orientation: landscape) and (max-height: 500px) {
  body.aoe-touch-mode .gs-hud {
    bottom: max(6px, env(safe-area-inset-bottom, 0px));
    width: min(380px, calc(100vw - var(--aoe-stick-zone, 150px) - var(--aoe-jump-zone, 240px) - 32px));
    gap: 3px;
  }
  body.aoe-touch-mode .gs-hud__sprint { height: 26px; border-width: 3px; }
  body.aoe-touch-mode .gs-hud__sprint-label { font-size: 13px; }
  body.aoe-touch-mode .gs-hud__speed { font-size: 20px; }
  body.aoe-touch-mode .gs-hud__rate { display: none; }
  body.aoe-touch-mode .gs-hud__kmh { display: none; }
  body.aoe-touch-mode .gs-hud__level { height: 26px; border-width: 3px; }
  body.aoe-touch-mode .gs-hud__level-chip, body.aoe-touch-mode .gs-hud__level-label { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .gs-hud__sprint-fill, .gs-hud__level-fill { transition: none; }
  .gs-hud--levelled .gs-hud__level { animation: none; }
}
`;
  document.head.appendChild(style);
};
