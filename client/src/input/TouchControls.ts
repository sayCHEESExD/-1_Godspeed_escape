import type { InputState } from './InputState.js';

const ZONE_WIDTH = 0.5;
const ZONE_TOP = 0.32;
const RADIUS_VMIN = 0.15;
const RADIUS_MIN = 46;
const RADIUS_MAX = 84;
const DEADZONE = 0.18;
const LOOK_SENSITIVITY = 0.005;

export interface LookSink {
  addLookDelta(deltaX: number, deltaY: number): void;
}

/**
 * Touch controls: a virtual stick, a JUMP button, a SPRINT button (held) and
 * drag-to-look.
 *
 * A SOURCE, not a second movement system: it writes the same fields the
 * keyboard writes, through the same `InputManager`, into the same message.
 * The sprint button is HELD, exactly as Q is - a finger on it is the god
 * power running, a finger off it is the bar refilling.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly jumpButton: HTMLButtonElement;
  private readonly sprintButton: HTMLButtonElement;

  private canvas: HTMLElement | null = null;
  private readonly look: LookSink;
  private movePointer: number | null = null;
  private lookPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius = 64;
  private lookX = 0;
  private lookY = 0;
  private moveX = 0;
  private moveZ = 0;
  private jumpHeld = false;
  private jumpPulse = false;
  private sprintHeld = false;
  private visible = false;
  private suppressed = false;

  constructor(look: LookSink) {
    this.look = look;

    this.root = document.createElement('div');
    this.root.className = 'aoe-touch';
    this.root.hidden = true;

    this.stick = document.createElement('div');
    this.stick.className = 'aoe-touch__stick';
    this.knob = document.createElement('div');
    this.knob.className = 'aoe-touch__knob';
    this.stick.append(this.knob);

    this.jumpButton = document.createElement('button');
    this.jumpButton.className = 'aoe-touch__jump';
    this.jumpButton.type = 'button';
    this.jumpButton.setAttribute('aria-label', 'Jump');
    this.jumpButton.textContent = 'JUMP';

    this.sprintButton = document.createElement('button');
    this.sprintButton.className = 'aoe-touch__sprint';
    this.sprintButton.type = 'button';
    this.sprintButton.setAttribute('aria-label', 'Sprint (hold)');
    this.sprintButton.innerHTML = '<span>SPRINT</span><small>HOLD</small>';

    this.root.append(this.stick, this.sprintButton, this.jumpButton);
    injectStyles();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  attach(canvas: HTMLElement, container: HTMLElement): void {
    this.canvas = canvas;
    container.append(this.root);
    this.measure();

    canvas.addEventListener('pointerdown', this.onCanvasDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.measure);

    this.bindHold(this.jumpButton, (down) => {
      this.jumpHeld = down;
      if (down) this.jumpPulse = true;
    });
    this.bindHold(this.sprintButton, (down) => {
      this.sprintHeld = down;
    });
  }

  detach(): void {
    this.canvas?.removeEventListener('pointerdown', this.onCanvasDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.measure);
    this.root.remove();
    this.canvas = null;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    this.measure();
  }

  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    this.root.classList.toggle('aoe-touch--hidden', suppressed);
    if (suppressed) this.releaseAll();
  }

  apply(state: InputState): void {
    state.moveX += this.moveX;
    state.moveZ += this.moveZ;
    if (this.jumpHeld || this.jumpPulse) state.jump = true;
    if (this.sprintHeld) state.sprint = true;
    this.jumpPulse = false;
  }

  /** Reflect the sprint bar on the button, so a phone player sees the drain. */
  setSprintState(fraction: number, sprinting: boolean, locked: boolean): void {
    this.sprintButton.style.setProperty('--aoe-sprint-fill', `${Math.round(fraction * 100)}%`);
    this.sprintButton.classList.toggle('aoe-touch__sprint--on', sprinting);
    this.sprintButton.classList.toggle('aoe-touch__sprint--locked', locked);
  }

  /** A button that reports DOWN and UP, capturing the pointer so a slide off keeps it. */
  private bindHold(button: HTMLButtonElement, set: (down: boolean) => void): void {
    const down = (event: PointerEvent): void => {
      if (this.suppressed) return;
      event.stopPropagation();
      event.preventDefault();
      set(true);
      button.classList.add('is-down');
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* no capture; the window-level pointerup still releases */
      }
    };
    const up = (event: PointerEvent): void => {
      event.stopPropagation();
      set(false);
      button.classList.remove('is-down');
      try {
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
    button.addEventListener('contextmenu', preventDefault);
  }

  private readonly onCanvasDown = (event: PointerEvent): void => {
    if (this.suppressed || !this.visible) return;
    if (event.pointerType === 'mouse') return;

    if (this.movePointer === null && this.inStickZone(event.clientX, event.clientY)) {
      this.movePointer = event.pointerId;
      this.originX = event.clientX;
      this.originY = event.clientY;
      this.placeStick();
      this.stick.classList.add('aoe-touch__stick--active');
      this.updateStick(event.clientX, event.clientY);
      event.preventDefault();
      return;
    }

    if (this.lookPointer === null) {
      this.lookPointer = event.pointerId;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.suppressed) return;
    if (event.pointerId === this.movePointer) {
      this.updateStick(event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    if (event.pointerId === this.lookPointer) {
      this.look.addLookDelta(
        (event.clientX - this.lookX) * LOOK_SENSITIVITY,
        (event.clientY - this.lookY) * LOOK_SENSITIVITY,
      );
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.movePointer) this.releaseStick();
    if (event.pointerId === this.lookPointer) this.lookPointer = null;
  };

  private inStickZone(x: number, y: number): boolean {
    return x < window.innerWidth * ZONE_WIDTH && y > window.innerHeight * ZONE_TOP;
  }

  private readonly measure = (): void => {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    this.radius = Math.max(RADIUS_MIN, Math.min(vmin * RADIUS_VMIN, RADIUS_MAX));
    this.stick.style.setProperty('--aoe-stick-radius', `${this.radius}px`);
    document.documentElement.style.setProperty('--aoe-stick-radius', `${this.radius}px`);
    if (this.movePointer === null) this.placeStickAtRest();
  };

  private placeStick(): void {
    this.stick.style.left = `${this.originX}px`;
    this.stick.style.top = `${this.originY}px`;
  }

  private placeStickAtRest(): void {
    this.stick.style.left = '';
    this.stick.style.top = '';
  }

  private updateStick(x: number, y: number): void {
    const dx = x - this.originX;
    const dy = y - this.originY;
    const distance = Math.hypot(dx, dy);
    const deflection = Math.min(distance / this.radius, 1);

    if (deflection < DEADZONE || distance < 1e-4) {
      this.moveX = 0;
      this.moveZ = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const magnitude = (deflection - DEADZONE) / (1 - DEADZONE);
    const dirX = dx / distance;
    const dirY = dy / distance;
    this.moveX = dirX * magnitude;
    this.moveZ = -dirY * magnitude;

    const knobX = dirX * deflection * this.radius;
    const knobY = dirY * deflection * this.radius;
    this.knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  }

  private releaseStick(): void {
    this.movePointer = null;
    this.moveX = 0;
    this.moveZ = 0;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.stick.classList.remove('aoe-touch__stick--active');
    this.placeStickAtRest();
  }

  private releaseAll(): void {
    this.releaseStick();
    this.lookPointer = null;
    this.jumpHeld = false;
    this.jumpPulse = false;
    this.sprintHeld = false;
    this.jumpButton.classList.remove('is-down');
    this.sprintButton.classList.remove('is-down');
  }
}

const preventDefault = (event: Event): void => event.preventDefault();

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
:root {
  --aoe-jump-size: clamp(74px, 17vmin, 108px);
}
.aoe-touch {
  position: fixed;
  inset: 0;
  z-index: 22;
  pointer-events: none;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.aoe-touch[hidden] { display: none; }
.aoe-touch--hidden { opacity: 0; pointer-events: none; }

/* The stick: a soft white disc with a chunky dark rim, like the buttons. */
.aoe-touch__stick {
  --aoe-stick-radius: 64px;
  position: fixed;
  left: calc(var(--aoe-safe-l, 0px) + 26px + var(--aoe-stick-radius));
  top: auto;
  bottom: calc(var(--aoe-safe-b, 0px) + 26px);
  width: calc(var(--aoe-stick-radius) * 2);
  height: calc(var(--aoe-stick-radius) * 2);
  margin: calc(var(--aoe-stick-radius) * -1) 0 0 calc(var(--aoe-stick-radius) * -1);
  border: 3px solid rgba(20, 24, 40, 0.7);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.28);
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.25), inset 0 0 20px rgba(255, 255, 255, 0.3);
  opacity: 0.6;
  transition: opacity 140ms ease;
}
.aoe-touch__stick--active { bottom: auto; opacity: 0.95; transition: none; }
.aoe-touch__knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46%;
  height: 46%;
  transform: translate(-50%, -50%);
  border: 3px solid rgba(20, 24, 40, 0.8);
  border-radius: 50%;
  background: linear-gradient(180deg, #ffffff, #cfe6ff);
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.3);
}

/* The two action buttons: chunky rounded plates with a dark rim. */
.aoe-touch__jump,
.aoe-touch__sprint {
  position: fixed;
  bottom: calc(var(--aoe-safe-b, 0px) + 30px);
  width: var(--aoe-jump-size);
  height: var(--aoe-jump-size);
  padding: 0;
  border: 4px solid #1a1f33;
  border-radius: 24%;
  color: #ffffff;
  font-family: "Fredoka", "Baloo 2", "Nunito", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  font-size: clamp(14px, 3.4vmin, 20px);
  letter-spacing: 0.03em;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45);
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
}
.aoe-touch__jump {
  right: calc(var(--aoe-safe-r, 0px) + 24px);
  background: linear-gradient(180deg, #5ee0ff, #1fa8e8);
}
.aoe-touch__sprint {
  right: calc(var(--aoe-safe-r, 0px) + 24px + var(--aoe-jump-size) + 16px);
  bottom: calc(var(--aoe-safe-b, 0px) + 44px);
  --aoe-sprint-fill: 100%;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.12)),
    linear-gradient(0deg, #ffb52e var(--aoe-sprint-fill), #5a4420 var(--aoe-sprint-fill));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.aoe-touch__sprint small {
  font-size: 0.55em;
  opacity: 0.85;
  letter-spacing: 0.14em;
}
.aoe-touch__sprint--on { box-shadow: 0 0 22px rgba(255, 200, 60, 0.9), 0 6px 0 rgba(0, 0, 0, 0.3); }
.aoe-touch__sprint--locked { filter: saturate(0.4) brightness(0.8); }
.aoe-touch__jump.is-down,
.aoe-touch__sprint.is-down { transform: translateY(4px); box-shadow: 0 2px 0 rgba(0, 0, 0, 0.3); }

/*
 * A phone on its side: the HUD rail stands down the left edge at its middle,
 * so the stick's rest position moves right by the rail's lane. The rail is
 * 46px of tile plus its margin; --aoe-rail-lane is set by the HUD stylesheet
 * on the same media query, and falls back to the same figure here.
 */
@media (orientation: landscape) and (max-height: 500px) {
  .aoe-touch__stick {
    left: calc(var(--aoe-safe-l, 0px) + 26px + var(--aoe-rail-lane, 66px) + var(--aoe-stick-radius));
  }
}
`;
  document.head.append(style);
};
