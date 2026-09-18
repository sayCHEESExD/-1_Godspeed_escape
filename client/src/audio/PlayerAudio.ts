import type { AudioManager } from './AudioManager.js';

/** Below this, the player is not really moving and should be silent. */
const MIN_AUDIBLE_SPEED = 2.5;

/** World units of travel between two FOOTFALLS at a run. */
const STRIDE_DISTANCE = 2.6;

/** Most footfalls a second, so a sprint patters rather than buzzes. */
const MAX_STEPS_PER_SECOND = 7;

export interface PlayerAudioInput {
  readonly horizontalSpeed: number;
  readonly maxRunSpeed: number;
  readonly isGrounded: boolean;
  readonly justJumped: boolean;
  readonly justLanded: boolean;
  readonly justSprinted: boolean;
  readonly isSprinting: boolean;
  readonly isDying: boolean;
  readonly onTreadmill: boolean;
}

/**
 * Turns what the local player is doing into sounds.
 *
 * ONLY the local player is fed through here. Footfalls are synthesised per
 * stride from distance covered (the belt's, on a treadmill); the jump and the
 * death are the supplied recordings; the sprint is a whoosh on the edge.
 */
export class PlayerAudio {
  private readonly audio: AudioManager;
  private stride = 0;
  private sinceBeat = 0;
  private wasDying = false;

  constructor(audio: AudioManager) {
    this.audio = audio;
  }

  update(delta: number, player: PlayerAudioInput): void {
    if (player.isDying) {
      if (!this.wasDying) {
        this.wasDying = true;
        this.audio.play('death');
      }
      this.stride = 0;
      return;
    }
    this.wasDying = false;

    if (player.justJumped) this.audio.play('jump');
    if (player.justLanded) this.audio.play('land', this.loudness(player));
    if (player.justSprinted) this.audio.play('sprint');

    this.sinceBeat += delta;

    if (!player.isGrounded) {
      this.stride = 0;
      return;
    }

    const pace = player.onTreadmill ? player.maxRunSpeed : player.horizontalSpeed;
    if (pace < MIN_AUDIBLE_SPEED) {
      this.stride = 0;
      return;
    }

    this.stride += pace * delta;
    if (this.stride < STRIDE_DISTANCE) return;
    if (this.sinceBeat < 1 / MAX_STEPS_PER_SECOND) {
      this.stride = 0;
      return;
    }

    this.stride = 0;
    this.sinceBeat = 0;
    this.audio.play('step', 0.3 + this.loudness(player) * 0.5 + (player.isSprinting ? 0.2 : 0));
  }

  private loudness(player: PlayerAudioInput): number {
    const top = Math.max(1, player.maxRunSpeed * 1.85);
    const pace = player.onTreadmill ? player.maxRunSpeed : player.horizontalSpeed;
    return Math.min(pace / top, 1);
  }
}
