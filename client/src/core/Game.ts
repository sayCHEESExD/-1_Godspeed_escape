import {
  SPAWN_POSITION,
  SPRINT,
  toKmh,
  type RespawnMessage,
  type StageAwardedMessage,
} from '@godspeed/shared';
import { AudioManager } from '../audio/AudioManager.js';
import { Bloxity } from '../bloxity/Bloxity.js';
import { AvatarDresser } from '../bloxity/AvatarDresser.js';
import { lookFromLegion } from '../bloxity/avatarLook.js';
import { identityFromLegion } from '../bloxity/identity.js';
import { PlayerAudio } from '../audio/PlayerAudio.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { clientConfig } from '../config/clientConfig.js';
import { InputManager } from '../input/InputManager.js';
import { NetworkClient } from '../net/NetworkClient.js';
import type { ConnectionStatus, NetPlayerState } from '../net/netTypes.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { playerModelLoader, type PlayerModelReport } from '../player/PlayerModelLoader.js';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js';
import { RunController } from '../progression/RunController.js';
import { RendererManager } from '../rendering/RendererManager.js';
import { SceneManager } from '../rendering/SceneManager.js';
import { BackpackPanel } from '../ui/BackpackPanel.js';
import { CharmShopPanel } from '../ui/CharmShopPanel.js';
import { Panel, anyPanelOpen } from '../ui/Panel.js';
import { RailButton } from '../ui/RailButton.js';
import { RebirthPanel } from '../ui/RebirthPanel.js';
import { SpeedHud } from '../ui/SpeedHud.js';
import { SpeedPopups } from '../ui/SpeedPopups.js';
import { BloxityPanel } from '../ui/BloxityPanel.js';
import { WinsCounter } from '../ui/WinsCounter.js';
import { ICONS, injectHudStyles } from '../ui/hudStyles.js';
import { logger } from '../util/logger.js';
import { CourseWorld } from '../world/CourseWorld.js';

const SCOPE = 'Game';

const shortcutOf = (event: KeyboardEvent): string => {
  const code = event.code;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code) return code.toLowerCase();
  return (event.key || '').toLowerCase();
};

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/**
 * Composition root.
 *
 * Owns every subsystem and defines the per-frame update order, and holds no
 * gameplay rules of its own: input, then prediction, then triggers, then the
 * camera, then the network, then the render.
 */
export class Game {
  private readonly renderer: RendererManager;
  private readonly sceneManager = new SceneManager();
  private readonly camera = new ThirdPersonCamera();
  private readonly input = new InputManager();
  private readonly remotePlayers: RemotePlayerManager;
  private readonly hud: SpeedHud;
  private readonly pops: SpeedPopups;
  private readonly wins: WinsCounter;
  private readonly rail: HTMLDivElement;
  private readonly rebirthButton: RailButton;
  private readonly shopButton: RailButton;
  private readonly backpackButton: RailButton;
  private readonly audioButton: RailButton;
  private readonly audio = new AudioManager();
  private readonly bloxity: Bloxity;
  private readonly bloxityPanel: BloxityPanel;
  private readonly fpsReadout: HTMLDivElement;
  private dresser: AvatarDresser | null = null;
  private pendingAvatar: (() => void) | null = null;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private readonly playerAudio: PlayerAudio;
  private readonly rebirthPanel: RebirthPanel;
  private readonly backpack: BackpackPanel;
  private readonly charmShop: CharmShopPanel;
  private readonly network: NetworkClient;
  private readonly world = new CourseWorld();
  private readonly run: RunController;

  private localPlayer: LocalPlayer | null = null;
  private localSessionId: string | null = null;

  private lastLevel = -1;
  private lastRebirths = -1;
  private lastOwnedUpgrades = -1;
  private lastOwnedTrails = -1;
  private lastOwnedAuras = -1;
  private lastOwnedCharms = -1;
  private modelReport: PlayerModelReport | null = null;
  private worldTime = 0;
  private lastServerTime = -1;
  private pendingRespawn: RespawnMessage | null = null;

  constructor(container: HTMLElement) {
    injectHudStyles();
    this.renderer = new RendererManager(container);
    this.remotePlayers = new RemotePlayerManager(this.sceneManager.scene);
    this.hud = new SpeedHud(container);
    this.pops = new SpeedPopups(container);
    this.wins = new WinsCounter(container);

    this.rail = document.createElement('div');
    this.rail.className = 'aoe-rail';
    container.appendChild(this.rail);

    this.rebirthPanel = new RebirthPanel(container, () => this.network.requestRebirth());
    this.backpack = new BackpackPanel(container, {
      unlockTrail: (slot) => this.network.unlockTrail(slot),
      equipTrail: (slot) => this.network.equipTrail(slot),
      unlockAura: (slot) => this.network.unlockAura(slot),
      equipAura: (slot) => this.network.equipAura(slot),
      equipCharm: (slot, wear) => this.network.equipCharm(slot, wear),
    });
    this.charmShop = new CharmShopPanel(container, {
      buy: (shelfIndex) => this.network.buyCharm(shelfIndex),
    });

    this.rebirthButton = new RailButton(this.rail, {
      variant: 'rebirth',
      label: 'Rebirth',
      icon: ICONS.rebirth,
      hotkey: 'R',
      onClick: () => this.openOnly(this.rebirthPanel),
    });
    this.shopButton = new RailButton(this.rail, {
      variant: 'shop',
      label: 'Shop',
      icon: ICONS.shop,
      hotkey: 'C',
      onClick: () => this.openOnly(this.charmShop),
    });
    this.backpackButton = new RailButton(this.rail, {
      variant: 'backpack',
      label: 'Backpack',
      icon: ICONS.backpack,
      hotkey: 'B',
      onClick: () => this.openOnly(this.backpack),
    });
    this.audioButton = new RailButton(this.rail, {
      variant: 'audio',
      label: 'Sound',
      icon: ICONS.audio,
      hotkey: 'M',
      onClick: () => {
        const muted = this.audio.toggleMuted();
        this.audioButton.root.classList.toggle('aoe-tile--off', muted);
      },
    });

    this.playerAudio = new PlayerAudio(this.audio);

    this.bloxity = new Bloxity({
      setMasterVolume: (level) => this.audio.setMasterVolume(level),
      setMusicVolume: (level) => this.audio.setMusicVolume(level),
      setGraphicsQuality: (level) => this.renderer.setQuality(level),
      setShowFps: (show) => {
        this.fpsReadout.hidden = !show;
      },
      setCameraSensitivity: (scale) => this.input.look.setSensitivityScale(scale),
      respawn: () => this.network.requestRespawn(),
      pointerLockChanged: (locked) => this.input.look.setCursorFree(!locked),
      avatarChanged: (equipped, proportions) => {
        const look = lookFromLegion(equipped, proportions);
        this.network.sendAvatar(look);
        const apply = (): void => this.dresser?.setLook(look.appearance, look.proportions);
        if (this.dresser) apply();
        else this.pendingAvatar = apply;
      },
    });

    this.fpsReadout = document.createElement('div');
    this.fpsReadout.className = 'aoe-fps aoe-font';
    this.fpsReadout.hidden = true;
    container.appendChild(this.fpsReadout);

    this.bloxityPanel = new BloxityPanel(container, this.bloxity);

    window.addEventListener('keydown', this.onHotkey);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('mousedown', this.onGesture);
    window.addEventListener('touchstart', this.onGesture, { passive: true });

    this.renderer.onResize((width, height) => this.camera.setViewport(width, height));

    this.network = new NetworkClient({
      onStatusChange: (status) => this.onStatusChange(status),
      onSelfJoined: (sessionId) => {
        this.localSessionId = sessionId;
        const roomId = this.network.roomId;
        this.bloxity.updateRoom(roomId);
        this.bloxityPanel.setRoom(roomId);
      },
      onPlayerAdded: (sessionId, player) => this.onPlayerAdded(sessionId, player),
      onPlayerChanged: (sessionId, player) => this.onPlayerChanged(sessionId, player),
      onPlayerRemoved: (sessionId) => this.remotePlayers.remove(sessionId),
      onRespawn: (message) => {
        this.pendingRespawn = message;
        this.localPlayer?.acknowledgeRespawn();
        this.applyPendingRespawn();
      },
      onStageAwarded: (message) => this.onStageAwarded(message),
    });

    this.network.setIdentityProvider(() => this.bloxity.getUser()?._id ?? null);
    this.network.setLookProvider(() =>
      lookFromLegion(this.bloxity.getEquipped(), this.bloxity.getProportions()),
    );
    this.network.setDisplayProvider(() =>
      identityFromLegion(this.bloxity.getUser(), this.bloxity.getGuest()),
    );
    this.bloxity.onUserChanged((user) => {
      this.network.sendIdentity(identityFromLegion(user, this.bloxity.getGuest()));
    });

    this.run = new RunController(this.world.collision, {
      claimStage: (index) => {
        this.flushInput();
        this.network.claimStage(index);
      },
      unlockUpgrade: (slot) => {
        this.flushInput();
        this.network.unlockUpgrade(slot);
      },
    });
  }

  private readonly onHotkey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) return;
    if (isTyping(event.target)) return;

    switch (shortcutOf(event)) {
      case 'r':
        this.rebirthButton.press();
        break;
      case 'c':
        this.shopButton.press();
        break;
      case 'b':
        this.backpackButton.press();
        break;
      case 'm':
        this.audioButton.press();
        break;
      case 'escape':
        for (const panel of this.panels) panel.setOpen(false);
        this.input.look.setCursorFree(true);
        this.bloxity.showPortalMenu(true);
        break;
      default:
        break;
    }
  };

  private tickFps(delta: number): void {
    if (this.fpsReadout.hidden) return;
    this.fpsAccum += delta;
    this.fpsFrames += 1;
    if (this.fpsAccum < 0.5) return;
    const fps = Math.round(this.fpsFrames / this.fpsAccum);
    this.fpsReadout.textContent = `${fps} FPS`;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
  }

  private readonly onGesture = (): void => {
    this.audio.resume();
  };

  private openOnly(panel: Panel): void {
    for (const other of this.panels) {
      if (other !== panel) other.setOpen(false);
    }
    panel.toggle();
  }

  /** Every rail panel, in one list. */
  private get panels(): readonly Panel[] {
    return [this.rebirthPanel, this.charmShop, this.backpack];
  }

  startBloxity(): void {
    this.bloxity.start();
    document.body.classList.toggle('aoe-portal-embedded', this.bloxity.embedded);
  }

  loadingStep(text: string): void {
    this.bloxity.loadingStep(text);
  }

  async initialise(): Promise<PlayerModelReport> {
    this.world.addTo(this.sceneManager.scene);
    this.modelReport = await playerModelLoader.load();

    this.localPlayer = new LocalPlayer(this.world.collision);
    this.dresser = new AvatarDresser(this.localPlayer.character);
    this.pendingAvatar?.();
    this.pendingAvatar = null;

    this.sceneManager.scene.add(this.localPlayer.character.root);
    this.sceneManager.scene.add(this.localPlayer.character.worldRoot);
    this.camera.snapTo(this.localPlayer.position);

    logger.info(SCOPE, 'world ready');
    return this.modelReport;
  }

  async connect(): Promise<void> {
    await this.network.connect();
  }

  start(): void {
    this.input.attach(this.renderer.renderer.domElement);
    this.bloxity.loadingEnd();
    this.bloxity.gameplayStart();
  }

  stop(): void {
    this.input.detach();
    this.bloxity.gameplayEnd();
    this.bloxity.updateRoom('');
    void this.network.disconnect();
  }

  update(delta: number, _now: number): void {
    this.input.setSuppressed(anyPanelOpen());
    const input = this.input.sample();
    const player = this.localPlayer;

    this.camera.setOrbit(this.input.look.yaw, this.input.look.pitch);
    this.camera.setZoom(this.input.look.zoom);

    this.worldTime =
      this.network.elapsed > this.lastServerTime ? this.network.elapsed : this.worldTime + delta;
    this.lastServerTime = this.network.elapsed;
    const elapsed = this.worldTime;

    if (player) {
      player.setWorldTime(elapsed);
      player.update(delta, input, this.input.look.yaw);
      this.run.update(delta, player, elapsed);

      if (player.deathComplete) this.applyPendingRespawn();
      if (player.consumeRespawnNudge()) {
        logger.warn(SCOPE, 'death was not acknowledged; requesting a respawn');
        this.network.requestRespawn();
      }

      this.snapCameraIfPlaced();
      this.camera.setTarget(player.position);
      this.world.winTrophies.follow(player.position);
      this.world.revealNear(player.position.z);
      this.sceneManager.followShadow(player.position.x, player.position.y, player.position.z);
      this.flushInput();

      // THE SPRINT BAR is drawn from the PREDICTION, so it moves on the frame
      // the key goes down rather than a patch later. The server's figure
      // arrives through reconciliation and corrects it invisibly.
      this.hud.updateSprint(player.sprintFraction, player.isSprinting, player.sprintLocked);
      this.hud.updateSpeedometer(toKmh(player.onTreadmill ? player.maxRunSpeed * (player.isSprinting ? SPRINT.boost : 1) : player.horizontalSpeed));
      this.input.setSprintState(player.sprintFraction, player.isSprinting, player.sprintLocked);
    }

    this.tickFps(delta);
    if (player) this.playerAudio.update(delta, player);
    this.world.scoreboard.update(this.network.leaderboard);
    this.charmShop.setShelf(this.network.shop);
    this.pops.update(delta);
    this.world.update(delta, elapsed, player?.position.x ?? SPAWN_POSITION.x, player?.position.z ?? SPAWN_POSITION.z);
    this.remotePlayers.advance(delta, player?.position ?? null);
    this.camera.update(delta, player?.horizontalSpeed ?? 0);

    this.renderer.renderer.render(this.sceneManager.scene, this.camera.camera);
  }

  private flushInput(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const message of player.drainOutgoing()) this.network.sendInput(message);
  }

  private applyPendingRespawn(): void {
    const player = this.localPlayer;
    const message = this.pendingRespawn;
    if (!player || !message) return;
    if (player.isDying && !player.deathComplete) return;
    this.pendingRespawn = null;
    player.teleport(message.x, message.y, message.z, message.rotationY);
  }

  private snapCameraIfPlaced(): void {
    const player = this.localPlayer;
    if (!player) return;
    const placement = player.consumePlacement();
    if (placement === 'none') return;
    this.camera.snapTo(player.position, placement === 'respawn');
  }

  private onPlayerAdded(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.add(sessionId, state);
    this.bloxity.playerJoined(sessionId);
    this.bloxity.playerInRoom(sessionId);
  }

  private onPlayerChanged(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.update(sessionId, state);
  }

  /** Everything the server says about the local player. It derives none of it. */
  private applyLocalState(state: NetPlayerState): void {
    const player = this.localPlayer;
    if (!player) return;

    player.setMovementProfile(state.moveMultiplier, state.jumpVelocity, state.sprintCapacity);
    player.setCosmetics(state.trailSlot, state.auraSlot, state.upgradeSlot);
    player.setDisplayName(state.displayName, state.avatarUrl);

    if (state.ready) {
      player.reconcile({
        x: state.x,
        y: state.y,
        z: state.z,
        rotationY: state.rotationY,
        velocityX: state.velocityX,
        velocityY: state.velocityY,
        velocityZ: state.velocityZ,
        grounded: state.grounded,
        jumpCount: state.jumpCount,
        lastInputSeq: state.lastInputSeq,
        jumpLatched: state.jumpLatched,
        coyote: state.coyote,
        sprintEnergy: state.sprintEnergy,
        sprinting: state.sprinting,
        sprintLocked: state.sprintLocked,
        sprintRest: state.sprintRest,
      });
    }

    this.hud.updateProgress(state.totalSpeed, state.maxLevel, state.speedPerStep);
    this.pops.observe(state.totalSpeed);
    this.wins.update(state.wins);
    this.run.setInventory(state.ownedUpgrades, state.wins);
    this.world.terraces.setInventory(state.ownedUpgrades, state.wins);

    if (this.lastLevel >= 0 && state.level > this.lastLevel) this.audio.play('level');
    if (this.lastRebirths >= 0 && state.rebirths > this.lastRebirths) {
      this.audio.play('rebirth');
      this.pops.resetBaseline();
    }
    this.lastLevel = state.level;
    this.lastRebirths = state.rebirths;

    this.rebirthPanel.setProgress(state.level, state.rebirths);
    this.rebirthButton.setState(this.rebirthPanel.isEligible, !this.rebirthPanel.isEligible);

    this.backpack.setInventory({
      wins: state.wins,
      ownedTrails: state.ownedTrails,
      trailSlot: state.trailSlot,
      ownedAuras: state.ownedAuras,
      auraSlot: state.auraSlot,
      ownedCharms: state.ownedCharms,
      equippedCharms: state.equippedCharms,
    });
    this.backpackButton.setState(this.backpack.hasUnlockable);
    this.charmShop.setInventory(state.wins, state.ownedCharms);
    this.shopButton.setState(this.charmShop.hasAffordable);

    if (this.lastOwnedUpgrades >= 0 && state.ownedUpgrades !== this.lastOwnedUpgrades) this.audio.play('unlock');
    if (this.lastOwnedTrails >= 0 && state.ownedTrails !== this.lastOwnedTrails) this.audio.play('unlock');
    if (this.lastOwnedAuras >= 0 && state.ownedAuras !== this.lastOwnedAuras) this.audio.play('unlock');
    if (this.lastOwnedCharms >= 0 && state.ownedCharms !== this.lastOwnedCharms) this.audio.play('buy');
    this.lastOwnedUpgrades = state.ownedUpgrades;
    this.lastOwnedTrails = state.ownedTrails;
    this.lastOwnedAuras = state.ownedAuras;
    this.lastOwnedCharms = state.ownedCharms;
  }

  private onStageAwarded(message: StageAwardedMessage): void {
    this.launchWinTrophies(message.wins);
    this.wins.update(message.total);
    this.audio.play('win');
    logger.info(SCOPE, `stage ${message.stageIndex} banked: +${message.wins} wins`);
  }

  private launchWinTrophies(wins: number): void {
    const player = this.localPlayer;
    if (!player) return;
    this.world.winTrophies.follow(player.position);
    this.world.winTrophies.play(wins);
  }

  private onStatusChange(status: ConnectionStatus): void {
    if (clientConfig.debug) logger.info(SCOPE, `connection: ${status}`);
  }

  dispose(): void {
    this.stop();
    this.hud.dispose();
    this.pops.dispose();
    this.wins.dispose();
    window.removeEventListener('keydown', this.onHotkey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('mousedown', this.onGesture);
    window.removeEventListener('touchstart', this.onGesture);
    this.bloxity.dispose();
    this.bloxityPanel.dispose();
    this.dresser?.dispose();
    this.fpsReadout.remove();
    this.audio.dispose();
    this.rebirthButton.dispose();
    this.shopButton.dispose();
    this.backpackButton.dispose();
    this.audioButton.dispose();
    this.rebirthPanel.dispose();
    this.backpack.dispose();
    this.charmShop.dispose();
    this.rail.remove();
    this.remotePlayers.dispose();
    this.world.dispose();
    this.renderer.dispose();
  }
}
