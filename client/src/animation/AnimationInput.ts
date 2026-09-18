/**
 * The gameplay signals the animator consumes each frame. It reads these and
 * never writes back: it cannot move the player or decide an outcome.
 *
 * The local player fills it from its own prediction and every remote player
 * from replicated state, so both run the exact same animation code.
 */
export interface AnimationInput {
  grounded: boolean;
  /** Horizontal speed in world units per second. */
  horizontalSpeed: number;
  /** The player's authoritative movement multiplier, so gaits scale with it. */
  moveMultiplier: number;
  verticalVelocity: number;
  /** True while the god power is running. Deepens the cycle into a sprint. */
  sprinting: boolean;
  /** -1..1 steering, for the bank. */
  turn: number;
  /** True on the frame the jump starts. */
  jumpStarted: boolean;
  landed: boolean;
  /** True while the death animation should play. */
  dying: boolean;
}

export const createAnimationInput = (): AnimationInput => ({
  grounded: true,
  horizontalSpeed: 0,
  moveMultiplier: 1,
  verticalVelocity: 0,
  sprinting: false,
  turn: 0,
  jumpStarted: false,
  landed: false,
  dying: false,
});
