/**
 * Third-person chase camera tuning.
 *
 * Lives in shared config so gameplay can reason about framing without
 * importing the renderer.
 */
export interface CameraConfig {
  /** Distance behind the character at rest, in world units. */
  readonly distance: number;
  /** Height above the feet that the camera sits at. */
  readonly height: number;
  /** Height above the feet that the camera looks at - the chest. */
  readonly lookAtHeight: number;
  /** Positional smoothing factor per second (higher = snappier). */
  readonly followLerp: number;
  /** Vertical field of view in degrees at rest. */
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  /** Extra distance at full speed. */
  readonly speedDistance: number;
  /** Extra vertical FOV in degrees at full speed, for the sense of rush. */
  readonly speedFov: number;
  /** Speed at which the two allowances above are fully applied. */
  readonly speedReference: number;
  /** How fast the dynamic distance and FOV ease, per second. */
  readonly speedEase: number;
  /** Closest the player may pull the camera, as an OFFSET on `distance`. */
  readonly zoomMin: number;
  /** Furthest the player may push the camera, as an offset on `distance`. */
  readonly zoomMax: number;
  /** World units of zoom per wheel notch. */
  readonly zoomStep: number;
  /** How fast the zoom eases toward what the wheel asked for, per second. */
  readonly zoomEase: number;
}

/**
 * FRAMED FOR A 3.2-UNIT CHARACTER, Roblox-style: over the shoulder, a little
 * above, with the ground in shot under the feet and the course ahead.
 *
 * At a sprint it pulls back and widens: the boost nearly doubles the speed,
 * and the widening is most of what makes a sprint FEEL like a sprint.
 */
export const CAMERA: CameraConfig = {
  distance: 11,
  height: 4.6,
  lookAtHeight: 2.2,
  followLerp: 10,
  fov: 62,
  near: 0.1,
  far: 2400,
  speedDistance: 4.5,
  speedFov: 14,
  speedReference: 30,
  speedEase: 3,
  zoomMin: -6,
  zoomMax: 14,
  zoomStep: 1.4,
  zoomEase: 12,
};
