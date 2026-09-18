import { hasTouchSupport, isTouchPrimary, onFirstTouch } from '../config/device.js';
import { createInputState, type InputState } from './InputState.js';
import { KeyboardSource } from './KeyboardSource.js';
import { MouseLook } from './MouseLook.js';
import { TouchControls } from './TouchControls.js';

/**
 * Aggregates every input source into a single normalised InputState.
 *
 * Keyboard and touch are peers here: both merge into the same snapshot, so the
 * player controller, the prediction, the network message and every
 * server-authoritative rule downstream cannot tell them apart.
 */
export class InputManager {
  private readonly state: InputState = createInputState();
  private readonly keyboard = new KeyboardSource();
  readonly look = new MouseLook();
  private readonly touch = new TouchControls(this.look);
  private cancelTouchWatch: (() => void) | null = null;
  private suppressed = false;

  get touchActive(): boolean {
    return this.touch.isVisible;
  }

  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    this.look.setSuppressed(suppressed);
    this.touch.setSuppressed(suppressed);
  }

  /** Mirror the sprint bar on the touch button, so a phone player sees the drain. */
  setSprintState(fraction: number, sprinting: boolean, locked: boolean): void {
    this.touch.setSprintState(fraction, sprinting, locked);
  }

  attach(canvas: HTMLElement): void {
    this.keyboard.attach();
    this.look.attach(canvas);
    this.touch.attach(canvas, canvas.parentElement ?? document.body);

    if (isTouchPrimary()) {
      this.showTouchControls();
    } else if (hasTouchSupport()) {
      this.cancelTouchWatch = onFirstTouch(() => this.showTouchControls());
    }
  }

  detach(): void {
    this.keyboard.detach();
    this.look.detach();
    this.touch.detach();
    this.cancelTouchWatch?.();
    this.cancelTouchWatch = null;
  }

  /** Recompute the snapshot for this frame. */
  sample(): Readonly<InputState> {
    this.state.moveX = 0;
    this.state.moveZ = 0;
    this.state.jump = false;
    this.state.sprint = false;

    this.keyboard.apply(this.state);
    this.touch.apply(this.state);

    if (this.suppressed) {
      this.state.moveX = 0;
      this.state.moveZ = 0;
      this.state.jump = false;
      this.state.sprint = false;
      return this.state;
    }

    const magnitude = Math.hypot(this.state.moveX, this.state.moveZ);
    if (magnitude > 1) {
      this.state.moveX /= magnitude;
      this.state.moveZ /= magnitude;
    }

    return this.state;
  }

  private showTouchControls(): void {
    this.cancelTouchWatch?.();
    this.cancelTouchWatch = null;
    this.touch.show();
    document.body.classList.add('aoe-touch-mode');
  }
}
