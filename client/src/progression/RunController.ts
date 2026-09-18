import {
  ownsUpgrade,
  upgradeForSlot,
  upgradeTileAt,
  winPadAt,
  type WorldCollision,
} from '@godspeed/shared';
import type { LocalPlayer } from '../player/LocalPlayer.js';

/** Seconds between two requests of the same kind. */
const REQUEST_COOLDOWN = 0.5;

export interface RunActions {
  claimStage(stageIndex: number): void;
  unlockUpgrade(slot: number): void;
}

/**
 * Turns the player's position into REQUESTS.
 *
 * The one job: notice that the player has entered a trigger volume and ask
 * the server about it. Every actual decision is made server-side against the
 * transform the server itself simulated. The single exception is DEATH, and
 * it is a prediction: the client starts the fall-over the moment it can see
 * the player is doomed, and the server still decides.
 */
export class RunController {
  private readonly collision: WorldCollision;
  private readonly actions: RunActions;

  private stageCooldown = 0;
  private tileCooldown = 0;

  private ownedUpgrades = 0;
  private wins = 0;

  constructor(collision: WorldCollision, actions: RunActions) {
    this.collision = collision;
    this.actions = actions;
  }

  /** Mirror the replicated wallet and inventory. Gating only. */
  setInventory(ownedUpgrades: number, wins: number): void {
    this.ownedUpgrades = ownedUpgrades;
    this.wins = wins;
  }

  update(delta: number, player: LocalPlayer, elapsed: number): void {
    this.stageCooldown = Math.max(0, this.stageCooldown - delta);
    this.tileCooldown = Math.max(0, this.tileCooldown - delta);

    if (player.isDying) return;

    const { x, y, z } = player.position;

    if (this.collision.hasFallen(x, y, z) || this.collision.touchesHazard(x, y, z, elapsed)) {
      player.beginDeath();
      return;
    }

    const stage = winPadAt(x, y, z);
    if (stage && this.stageCooldown === 0) {
      this.stageCooldown = REQUEST_COOLDOWN;
      this.actions.claimStage(stage.index);
    }

    const slot = upgradeTileAt(x, y, z);
    if (slot !== null && this.tileCooldown === 0) {
      // Asking for a tier already owned, or one the player plainly cannot
      // unlock, would be a request the server refuses every frame.
      const tier = upgradeForSlot(slot);
      if (!ownsUpgrade(this.ownedUpgrades, slot) && this.wins >= tier.winsRequired) {
        this.tileCooldown = REQUEST_COOLDOWN;
        this.actions.unlockUpgrade(slot);
      }
    }
  }
}
