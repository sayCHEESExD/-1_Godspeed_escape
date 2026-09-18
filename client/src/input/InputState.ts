/** Normalised, device-agnostic input snapshot consumed by the player controller. */
export interface InputState {
  /** -1 (left) .. 1 (right), camera-relative. */
  moveX: number;
  /** -1 (back) .. 1 (forward), camera-relative. */
  moveZ: number;
  /** The jump control (Space, or the on-screen JUMP button), HELD. */
  jump: boolean;
  /**
   * The SPRINT control (Q, or the on-screen SPRINT button), HELD.
   *
   * A LEVEL, not an edge: the god power runs for exactly as long as the key
   * is down and the bar has energy, and the shared simulation is what decides
   * both. There is no toggle.
   */
  sprint: boolean;
}

export const createInputState = (): InputState => ({
  moveX: 0,
  moveZ: 0,
  jump: false,
  sprint: false,
});
