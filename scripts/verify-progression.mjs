/**
 * The progression rules, exercised in-process.
 *
 * Every figure the specification pins down is asserted here EXACTLY: the level
 * curve's reference points, the rebirth ladder, the fifteen speed upgrades,
 * the nineteen trails, the six auras, the charm shop's restock and the
 * charms' effects. Then the server's own services are driven through the
 * paths a client can reach - including every rejection - so "the server
 * decides" is something this script proves rather than something the comments
 * claim.
 *
 * Run after `npm run build:server`.
 */
import * as S from '../shared/dist/index.js';
import { PlayerState } from '../server/dist/rooms/state/PlayerState.js';
import { SpeedService } from '../server/dist/progression/SpeedService.js';
import { UpgradeService } from '../server/dist/progression/UpgradeService.js';
import { TrailService } from '../server/dist/progression/TrailService.js';
import { AuraService } from '../server/dist/progression/AuraService.js';
import { CharmService, charmShop } from '../server/dist/progression/CharmService.js';
import { RebirthService } from '../server/dist/progression/RebirthService.js';
import { StageService } from '../server/dist/progression/StageService.js';
import { wallet } from '../server/dist/progression/Wallet.js';

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => console.log(`  ok    ${message}`);
const check = (condition, message) => (condition ? pass(message) : fail(message));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Step the wall clock, so a spam cooldown can be stepped past in a test. */
let clockOffset = 0;
const realNow = Date.now;
Date.now = () => realNow() + clockOffset;
const advanceClock = (ms) => {
  clockOffset += ms;
};

// ---------------------------------------------------------------- the curve
console.log('level curve');
check(S.speedForNextLevel(10) === 245, 'level 10 requires 245');
check(S.speedForNextLevel(11) === 264, 'level 11 requires 264');
check(S.speedForNextLevel(12) === 284, 'level 12 requires 284');
check(S.speedForNextLevel(21) === 544, 'level 21 requires 544 (the reference bar)');
check(S.MAX_LEVEL === 200, 'the level cap is 200');
{
  let monotonic = true;
  for (let level = 2; level <= 200; level += 1) {
    if (S.speedForNextLevel(level) <= S.speedForNextLevel(level - 1)) monotonic = false;
  }
  check(monotonic, 'every level costs more than the one before');
  const top = S.totalSpeedToReach(200);
  check(top > 1e7 && top < 1e9, `reaching level 200 needs ${S.formatSpeed(top)} Speed: meaningful, not absurd`);
  check(S.resolveLevel(0).level === 1, 'zero Speed is level 1');
  check(S.resolveLevel(S.totalSpeedToReach(15)).level === 15, 'the cumulative table and the resolver agree at 15');
  check(S.resolveLevel(1e12).level === 200 && S.resolveLevel(1e12).capped, 'a huge total caps at 200');
}

// --------------------------------------------------------------- rebirths
console.log('rebirth');
check(S.rebirthRequiredLevel(0) === 15, 'the first rebirth needs level 15');
check(S.rebirthRequiredLevel(1) >= 40 && S.rebirthRequiredLevel(1) <= 50, 'the second needs 40-50');
check(S.rebirthRequiredLevel(2) >= 75, 'the third needs 75+');
check(S.rebirthRequiredLevel(9) === 200, 'later rebirths settle at the cap');
check(same([0, 1, 2, 3, 4].map(S.rebirthMultiplier), [1, 1.5, 2, 2.5, 3]), 'multipliers 1, 1.5, 2, 2.5, 3');
check(S.canRebirth(15, 0) && !S.canRebirth(14, 0), 'eligible at 15, not at 14');
check(S.maxLevelForRebirth(0) === 200 && S.maxLevelForRebirth(5) === 200, 'the cap never moves');

// --------------------------------------------------------------- upgrades
console.log('speed upgrades');
{
  const expected = [
    [1, 0], [2, 1], [4, 10], [8, 100], [16, 500], [32, 2_500], [64, 50_000], [128, 75_000],
    [256, 325_000], [512, 12_000_000], [1_000, 10_000_000], [2_000, 50_000_000],
    [4_000, 250_000_000], [8_000, 1_000_000_000], [16_000, 5_000_000_000],
  ];
  const actual = S.SPEED_UPGRADES.map((t) => [t.speedPerStep, t.winsRequired]);
  check(same(actual, expected), 'fifteen tiers, exactly as specified (including +512 > +1K)');
  check(S.SPEED_UPGRADES.every((t, i) => t.slot === i + 1), 'slots are contiguous from 1');
  check(new Set(S.SPEED_UPGRADES.map((t) => t.power.style + t.power.color)).size >= 12, 'every tier has its own power look');
  check(S.bestOwnedUpgrade(S.INITIAL_OWNED_UPGRADES).slot === 1, 'a fresh profile is on the starter');
  check(S.bestOwnedUpgrade(S.upgradeBit(1) | S.upgradeBit(5)).slot === 5, 'the best owned is equipped');
}

// ----------------------------------------------------------------- trails
console.log('trails');
{
  const bonuses = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000];
  const required = [0, 3, 10, 100, 500, 2_500, 15_000, 75_000, 375_000, 2_000_000, 10_000_000, 50_000_000,
    250_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000, 55_000_000_000, 500_000_000_000, 4_000_000_000_000];
  check(same(S.TRAIL_TIERS.map((t) => t.bonus), bonuses), 'nineteen trail bonuses, exactly as specified');
  check(same(S.TRAIL_TIERS.map((t) => t.winsRequired), required), 'nineteen trail requirements, exactly as specified');
  check(S.trailBonus(3, S.trailMask(3)) === 4 && S.trailBonus(3, 0) === 0, 'an unowned trail is worth nothing');
}

// ------------------------------------------------------------------ auras
console.log('auras');
{
  const expected = [[1.5, 1_000], [2, 30_000], [3, 700_000], [5, 25_000_000], [10, 2_500_000_000], [25, 100_000_000_000]];
  check(same(S.AURA_TIERS.map((t) => [t.multiplier, t.winsRequired]), expected), 'six auras, exactly as specified');
  check(S.auraMultiplier(2, 0) === 1, 'an unowned aura multiplies by 1');
}

// ----------------------------------------------------------------- charms
console.log('charms');
{
  const byId = Object.fromEntries(S.CHARMS.map((c) => [c.id, c]));
  check(byId.endurance_shield?.rarity === 'epic' && byId.endurance_shield.effect.kind === 'sprint' &&
    byId.endurance_shield.effect.percent === 7 && byId.endurance_shield.price === 250_000, 'Epic Endurance Shield: +7% sprint, 250,000');
  check(byId.blue_flame?.rarity === 'rare' && byId.blue_flame.effect.percent === 6 && byId.blue_flame.price === 25_000, 'Rare Blue Flame: +6% speed, 25,000');
  check(byId.star?.rarity === 'rare' && byId.star.effect.percent === 3 && byId.star.price === 25_000, 'Rare Star: +3% speed, 25,000');
  check(S.CHARM_SHOP.restockSeconds === 300 && S.CHARM_SHOP.slots === 3, 'the shop restocks every 5 minutes with 3 charms');
  check(S.CHARMS.every((c) => c.slot >= 1 && c.slot <= S.MAX_CHARM_SLOTS), 'every charm fits the owned mask');
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let distinct = true;
  for (let i = 0; i < 200; i += 1) {
    const shelf = S.drawShelf(random);
    if (shelf.length !== 3 || new Set(shelf).size !== 3 || shelf.some((s) => !S.charmBySlot(s))) distinct = false;
  }
  check(distinct, 'two hundred restocks each drew three distinct real charms');
  const worn = S.charmMask(byId.blue_flame.slot) | S.charmMask(byId.star.slot) | S.charmMask(byId.endurance_shield.slot);
  const bonuses = S.charmBonuses(worn, worn);
  check(Math.abs(bonuses.speed - 1.09) < 1e-9 && Math.abs(bonuses.sprint - 1.07) < 1e-9, 'worn charms add: +9% speed, +7% sprint');
  check(S.charmBonuses(worn, 0).speed === 1, 'a worn but unowned charm counts for nothing');
  check(Math.abs(S.sprintDrainPerSecond(1.07) - S.SPRINT.drainPerSecond / 1.07) < 1e-9, '+7% sprint duration is 7% less drain');
}

// -------------------------------------------------------------- the rate
console.log('speed per step');
{
  const base = { upgradeSlot: 1, trailSlot: 1, ownedTrails: 1, auraSlot: 0, ownedAuras: 0, equippedCharms: 0, ownedCharms: 0, rebirths: 0 };
  check(S.speedPerStepFor(base) === 2, 'starter: +1 tile + +1 trail = 2 per step');
  const veteran = { upgradeSlot: 3, trailSlot: 3, ownedTrails: S.trailMask(3), auraSlot: 1, ownedAuras: S.auraMask(1), equippedCharms: 0, ownedCharms: 0, rebirths: 1 };
  check(S.speedPerStepFor(veteran) === (4 + 4) * 1.5 * 1.5, '(4 + 4) x rebirth 1.5 x aura 1.5 = 18');
}

// ------------------------------------------------------------- services
console.log('server services');
const speeds = new SpeedService();
const player = new PlayerState();
player.sessionId = 'probe';
speeds.initialise(player);
check(player.level === 1 && player.speedPerStep === 2 && player.maxLevel === 200, 'a fresh player: level 1, +2 per step, cap 200');

{
  // Strides on the ground pay; the first step after a placement does not.
  const step = 1 / 60;
  const perStep = 16 * step;
  speeds.reset('probe');
  let paid = 0;
  for (let i = 0; i < 120; i += 1) {
    player.x += perStep;
    paid += speeds.credit('probe', player, step, perStep, true).gained;
  }
  const strides = Math.floor((119 * perStep) / S.SPEED.strideDistance);
  check(paid === strides * 2, `two seconds of running paid ${paid} Speed for ${strides} strides`);
  const before = player.totalSpeed;
  speeds.credit('probe', player, step, perStep, false).gained;
  check(player.totalSpeed === before, 'an airborne step pays nothing');
  speeds.credit('probe', player, step, 400, true);
  check(player.totalSpeed === before, 'a teleport pays nothing');
  // A treadmill pays the belt's distance with the player going nowhere.
  player.treadmill = 1;
  let belt = 0;
  for (let i = 0; i < 120; i += 1) belt += speeds.credit('probe', player, step, 0, true).gained;
  check(belt > 0 && belt === paid, `two seconds on a belt paid ${belt}: exactly what running paid`);
  player.treadmill = 0;
}

{
  const upgrades = new UpgradeService();
  upgrades.initialise(player);
  const tile = (slot) => {
    player.x = S.upgradeTileX(slot);
    player.y = S.upgradeTileY(slot) + S.UPGRADE_ROWS.tileHeight;
    player.z = S.upgradeTileZ(slot);
  };
  player.wins = 0;
  tile(2);
  check(upgrades.claim(player, 2, speeds).reason === 'too-few-wins', 'tile +2 refused with 0 Wins');
  player.wins = 1;
  player.x += 20;
  check(upgrades.claim(player, 2, speeds).reason === 'not-on-tile', 'tile +2 refused when not standing on it');
  tile(2);
  const claim = upgrades.claim(player, 2, speeds);
  check(claim.granted && player.upgradeSlot === 2 && player.wins === 0, 'tile +2 unlocked with 1 Win, and the Win is SPENT');
  check(player.speedPerStep === 3, 'the rate is now +2 tile + +1 trail = 3');
  check(upgrades.claim(player, 2, speeds).reason === 'already-owned', 'a second claim is refused');
  check(upgrades.claim(player, 99, speeds).reason === 'unknown-slot', 'an unknown slot is refused');
  tile(10);
  player.wins = 10_000_000;
  check(upgrades.claim(player, 10, speeds).reason === 'too-few-wins', '+512 needs 12,000,000 - 10,000,000 is refused');
  // The spam cooldown between two ACCEPTED claims, stepped past.
  tile(11);
  check(upgrades.claim(player, 11, speeds).reason === 'cooldown', 'a second unlock inside the cooldown is refused');
  advanceClock(1000);
  check(upgrades.claim(player, 11, speeds).granted && player.upgradeSlot === 11, '+1K unlocks at 10,000,000 (the unusual step is preserved)');
  player.wins = 0;
  player.x = 0;
  player.z = -78;
  player.y = 0;
}

{
  const trails = new TrailService();
  trails.initialise(player);
  player.wins = 2;
  check(trails.unlock(player, 2, speeds).reason === 'too-few-wins', 'trail +2 refused with 2 Wins');
  player.wins = 3;
  check(trails.unlock(player, 2, speeds).ok && player.trailSlot === 2 && player.wins === 0, 'trail +2 unlocked with 3 Wins, and they are spent');
  check(trails.equip(player, 5, speeds).reason === 'not-owned', 'wearing an unowned trail is refused');
  check(trails.equip(player, 0, speeds).ok && player.trailSlot === 0, 'a trail can be taken off');
  check(trails.equip(player, 1, speeds).ok && player.trailSlot === 1, 'the free trail can be worn again');
  check(trails.unlock(player, 'x', speeds).reason === 'unknown-slot', 'garbage is refused');
}

{
  const auras = new AuraService();
  auras.initialise(player);
  player.wins = 999;
  check(auras.unlock(player, 1, speeds).reason === 'too-few-wins', 'aura 1 refused with 999 Wins');
  player.wins = 1_000;
  check(auras.unlock(player, 1, speeds).ok && player.auraSlot === 1 && player.wins === 0, 'aura 1 unlocked with 1,000 Wins, and they are spent');
  check(player.speedPerStep === S.speedPerStepFor({
    upgradeSlot: player.upgradeSlot, trailSlot: player.trailSlot, ownedTrails: player.ownedTrails,
    auraSlot: 1, ownedAuras: player.ownedAuras, equippedCharms: 0, ownedCharms: 0, rebirths: 0,
  }), 'the rate re-derives with the aura');
  check(auras.equip(player, 0, speeds).ok && player.auraSlot === 0, 'an aura can be taken off');
}

{
  const charms = new CharmService();
  charms.initialise(player);
  const shelf = charmShop.current();
  check(shelf.length === 3, 'the live shop holds three charms');
  const first = S.charmBySlot(shelf[0]);
  player.wins = first.price - 1;
  check(charms.buy(player, 0, speeds).reason === 'too-poor', `${first.name} refused one Win short`);
  player.wins = first.price;
  const bought = charms.buy(player, 0, speeds);
  check(bought.ok && player.wins === 0 && S.isCharmOwned(player.ownedCharms, first.slot), `${first.name} bought and PAID for`);
  check(S.isCharmOwned(player.equippedCharms, first.slot), 'a fresh charm is worn');
  check(charms.buy(player, 0, speeds).reason === 'already-owned', 'buying it again is refused');
  check(charms.buy(player, 7, speeds).reason === 'not-stocked', 'an empty shelf position is refused');
  // The equip limit.
  player.ownedCharms = 0b1111;
  player.equippedCharms = 0b0111;
  check(charms.equip(player, 4, speeds).reason === 'limit', `a fourth charm is refused at the limit of ${S.CHARM_EQUIP_LIMIT}`);
  check(charms.unequip(player, 1, speeds).ok && charms.equip(player, 4, speeds).ok, 'taking one off makes room');
  check(charms.equip(player, 9, speeds).reason === 'not-owned', 'wearing an unowned charm is refused');
  check(player.sprintCapacity >= 1, 'sprint capacity follows the worn charms');
  charmShop.restock();
  check(charmShop.current().length === 3 && charmShop.secondsLeft() <= 300 && charmShop.secondsLeft() > 290, 'a restock resets the five-minute clock');
  player.ownedCharms = 0;
  player.equippedCharms = 0;
  speeds.syncDerived(player);
}

{
  const rebirths = new RebirthService();
  player.totalSpeed = S.totalSpeedToReach(14);
  speeds.syncDerived(player);
  check(!rebirths.isEligible(player) && rebirths.rebirth(player, speeds).ok === false, 'level 14 cannot rebirth');
  player.totalSpeed = S.totalSpeedToReach(15);
  speeds.syncDerived(player);
  player.wins = 42;
  const owned = player.ownedUpgrades;
  const result = rebirths.rebirth(player, speeds);
  check(result.ok && result.rebirths === 1 && result.multiplier === 1.5, 'level 15 rebirths to x1.5');
  check(player.level === 1 && player.totalSpeed === 0, 'the level curve is reset');
  check(player.wins === 42 && player.ownedUpgrades === owned && player.trailSlot === 1, 'Wins, upgrades and trails are kept');
  check(player.speedPerStep === S.speedPerStepFor({
    upgradeSlot: player.upgradeSlot, trailSlot: 1, ownedTrails: player.ownedTrails,
    auraSlot: 0, ownedAuras: player.ownedAuras, equippedCharms: 0, ownedCharms: 0, rebirths: 1,
  }), 'the rate carries the x1.5');
}

{
  const stages = new StageService();
  stages.initialise('probe');
  const stage = S.STAGES[0];
  player.wins = 0;
  player.x = stage.winPadX;
  player.y = stage.padY;
  player.z = stage.winPadZ - 40;
  check(stages.claim('probe', player, 1).reason === 'not-on-pad', 'a claim away from the pad is refused');
  player.z = stage.winPadZ;
  const award = stages.claim('probe', player, 1);
  check(award.granted && award.wins === 1 && player.wins === 1 && player.bestStage === 1, 'standing on pad 1 pays 1 Win');
  check(stages.claim('probe', player, 2).reason === 'not-on-pad', 'claiming stage 2 from pad 1 is refused');
  check(stages.claim('probe', player, 99).reason === 'unknown-stage', 'an unknown stage is refused');
  const rewards = S.STAGES.map((s) => s.winReward);
  check(rewards.every((r, i) => i === 0 || r > rewards[i - 1]) && rewards[11] >= 100_000, `rewards climb from ${rewards[0]} to ${rewards[11]}`);
}

{
  player.wins = S.MAX_WINS - 1;
  wallet.add(player, 10);
  check(player.wins === S.MAX_WINS, 'Wins saturate at the ceiling rather than overflowing');
  check(!wallet.spend(player, S.MAX_WINS + 1) && player.wins === S.MAX_WINS, 'an unaffordable spend changes nothing');
}

// --------------------------------------------------------- the sprint bar
console.log('sprint');
{
  const motion = S.createMotion();
  const events = S.createSimEvents();
  const collision = new S.WorldCollision();
  const params = { moveMultiplier: 1, jumpVelocity: S.MOVEMENT.jumpVelocity, sprintCapacity: 1, time: 0 };
  const input = { moveX: 0, moveZ: 1, jump: false, sprint: true, cameraYaw: 0 };
  for (let i = 0; i < 60; i += 1) S.stepPlayer(motion, input, params, 1 / 60, collision, events);
  const drained = S.SPRINT.maxEnergy - motion.sprintEnergy;
  check(Math.abs(drained - S.SPRINT.drainPerSecond) < 1, `one second of Q drains ${drained.toFixed(1)} of ${S.SPRINT.maxEnergy}`);
  check(motion.sprinting && S.horizontalSpeed(motion) > S.MOVEMENT.moveSpeed * 1.5, 'the sprint runs faster than the run');
  for (let i = 0; i < 60 * 4; i += 1) S.stepPlayer(motion, input, params, 1 / 60, collision, events);
  check(motion.sprintEnergy === 0 && motion.sprintLocked && !motion.sprinting, 'the bar runs dry and the power locks');
  input.sprint = false;
  for (let i = 0; i < 60; i += 1) S.stepPlayer(motion, input, params, 1 / 60, collision, events);
  check(motion.sprintEnergy > 20 && !motion.sprintLocked, `a second's rest refills ${motion.sprintEnergy.toFixed(0)} and unlocks it`);
  for (let i = 0; i < 60 * 3; i += 1) S.stepPlayer(motion, input, params, 1 / 60, collision, events);
  check(motion.sprintEnergy === S.SPRINT.maxEnergy, 'and it refills completely within a few seconds');
}

console.log('');
console.log(failures === 0 ? 'progression OK' : `${failures} problem(s) found`);
process.exit(failures === 0 ? 0 : 1);
