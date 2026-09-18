/**
 * Static checks on the generated course, and a few runs through the real
 * simulation.
 *
 * The course is GENERATED from a builder table, so a tuning change can quietly
 * produce a gap no player could cross or a climb no jump could make. This
 * reads the same arrays the renderer and the server read and asserts the rules
 * the builders were written against - then drives `stepPlayer` across the hub,
 * onto a treadmill, up the terrace stairs and through the gate, so the places
 * a player has to be able to walk are places the simulation lets them walk.
 *
 * Run after `npm run build:shared`.
 */
import * as S from '../shared/dist/index.js';

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => console.log(`  ok    ${message}`);
const check = (condition, message) => (condition ? pass(message) : fail(message));

const collision = new S.WorldCollision();
const params = { moveMultiplier: 1, jumpVelocity: S.MOVEMENT.jumpVelocity, sprintCapacity: 1, time: 0 };
const events = S.createSimEvents();

/** Walk a motion with an input for `seconds`, stepping at 60 Hz. */
const walk = (motion, input, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    params.time += 1 / 60;
    S.stepPlayer(motion, input, params, 1 / 60, collision, events);
  }
};
const place = (x, y, z) => {
  const motion = S.createMotion();
  S.resetMotion(motion, x, y, z, 0);
  return motion;
};

// ------------------------------------------------------------ the layout
console.log('layout');
check(S.STAGES.length === S.COURSE.stageCount && S.STAGES.length === 12, 'twelve stages');
check(S.STAGES[0].startZ === S.COURSE.lobbyEndZ, 'stage 1 begins exactly where the hub ends');
{
  let ordered = true;
  for (let i = 1; i < S.STAGES.length; i += 1) {
    const prev = S.STAGES[i - 1];
    const next = S.STAGES[i];
    if (Math.abs(next.startZ - (prev.endZ + S.COURSE.stageGap)) > 1e-6) ordered = false;
    if (Math.abs(next.startY - prev.endY) > 1e-6) ordered = false;
  }
  check(ordered, 'every stage starts where the last one ended, plus the bridge, at the same height');
  check(S.STAGES.every((s, i) => i === 0 || s.recommendedLevel > S.STAGES[i - 1].recommendedLevel), 'recommended levels climb');
  check(Number.isFinite(S.STAGES[11].recommendedLevel) && S.STAGES[11].recommendedLevel > 0, 'the last stage recommends a real level');
  check(S.COURSE_TOP_Y > 60, `the course climbs to ${S.COURSE_TOP_Y.toFixed(0)} units: a vertical ascent`);
}

// ------------------------------------------------------------- the gaps
console.log('gaps and climbs');
{
  const reach = S.BALLISTIC_REACH;
  const rise = S.BALLISTIC_RISE;
  const walkable = new Set(['floor', 'island', 'cloud', 'bridge', 'sinking', 'launch', 'ice']);
  let worstGap = 0;
  let worstRise = 0;
  let bad = 0;
  for (const stage of S.STAGES) {
    const tops = [...S.COURSE_SOLIDS, ...S.SINKING_SOLIDS]
      .filter((s) => s.stage === stage.index && walkable.has(s.kind))
      // A shutter is a sinking WALL, not a floor: taller than it is long.
      .filter((s) => s.maxY - s.minY <= s.maxZ - s.minZ + 4)
      .sort((a, b) => a.minZ - b.minZ);
    for (let i = 1; i < tops.length; i += 1) {
      const from = tops[i - 1];
      const to = tops[i];
      const gap = to.minZ - from.maxZ;
      if (gap <= 0) continue;
      // Not a gap at all if some other floor spans it (a plate under shutters,
      // a runway under a side bridge).
      const covered = tops.some((s) => s !== from && s !== to && s.minZ <= from.maxZ + 0.1 && s.maxZ >= to.minZ - 0.1);
      if (covered) continue;
      // A launch pad's flight is measured by the pad check below, not here.
      if (nearLaunchPad(from)) continue;
      const climb = to.maxY - from.maxY;
      worstGap = Math.max(worstGap, gap);
      worstRise = Math.max(worstRise, climb);
      // A gap is measured along Z between the two nearest edges; a climb must
      // leave room for the arc to still be rising when it lands.
      if (gap > reach * 0.85) {
        bad += 1;
        console.log(`        stage ${stage.index}: gap ${gap.toFixed(1)} between z ${from.maxZ.toFixed(0)} and ${to.minZ.toFixed(0)}`);
      }
      if (climb > rise * 0.7 && !nearLaunchPad(from)) {
        bad += 1;
        console.log(`        stage ${stage.index}: climb ${climb.toFixed(1)} at z ${to.minZ.toFixed(0)}`);
      }
    }
  }
  check(bad === 0, `every gap fits a RUN (worst ${worstGap.toFixed(1)} of ${reach.toFixed(1)}) and every climb a jump (worst ${worstRise.toFixed(1)} of ${rise.toFixed(1)})`);
  check(S.SPRINT_REACH > reach * 1.6, `a sprint leaps ${S.SPRINT_REACH.toFixed(1)}: the power is speed, never a requirement`);
}

/** True when a platform sits over a launch pad, whose climb is the pad's. */
function nearLaunchPad(solid) {
  return S.SURFACE_REGIONS.some(
    (r) => r.boost > 0 && r.minZ <= solid.maxZ + 1 && r.maxZ >= solid.minZ - 1,
  );
}

// ------------------------------------------------------------ launch pads
console.log('launch pads');
{
  let ok = true;
  for (const pad of S.SURFACE_REGIONS) {
    if (pad.boost <= 0) continue;
    const padX = (pad.minX + pad.maxX) / 2;
    const padZ = (pad.minZ + pad.maxZ) / 2;
    // The highest surface at the pad IS the pad; asked from far above it.
    const padY = collision.surfaceYAt(padX, padZ, 10_000);
    const height = (pad.boost * pad.boost) / (2 * S.MOVEMENT.gravity);
    // The plateau: the nearest floor ahead of the pad in its stage.
    const ahead = S.COURSE_SOLIDS.filter(
      (s) => s.stage === pad.stage && s.minZ > pad.maxZ && s.minZ < pad.maxZ + 60 && s.kind === 'floor',
    ).sort((a, b) => a.minZ - b.minZ);
    const plateau = ahead[0];
    if (padY === null || !plateau) {
      ok = false;
      console.log(`        stage ${pad.stage}: pad has no plateau ahead of it`);
      continue;
    }
    const climb = plateau.maxY - padY;
    const g = S.MOVEMENT.gravity;
    // When the arc, launched at the pad's boost, is next at the plateau's
    // height on the way DOWN - and how far a RUN carries the player by then.
    const disc = pad.boost * pad.boost - 2 * g * climb;
    const landAt = disc < 0 ? Number.POSITIVE_INFINITY : (pad.boost + Math.sqrt(disc)) / g;
    const runReach = S.MOVEMENT.moveSpeed * landAt;
    const edge = plateau.minZ - padZ;
    // And whether the player has cleared the plateau's height by its edge.
    const tEdge = edge / S.MOVEMENT.moveSpeed;
    const heightAtEdge = pad.boost * tEdge - 0.5 * g * tEdge * tEdge;
    if (climb > height - 1 || runReach < edge + 2 || heightAtEdge < climb + 0.3) {
      ok = false;
      console.log(
        `        stage ${pad.stage}: pad throws ${height.toFixed(1)} high and a run lands ${runReach.toFixed(1)} out; ` +
          `the plateau is ${climb.toFixed(1)} up and starts ${edge.toFixed(1)} out (${heightAtEdge.toFixed(1)} high at its edge)`,
      );
    } else {
      pass(`stage ${pad.stage}: the pad lands a RUN on the plateau (${runReach.toFixed(0)} out, plateau at ${edge.toFixed(0)}-${(plateau.maxZ - padZ).toFixed(0)})`);
    }
  }
  check(ok, 'every launch pad throws the player high enough for the plateau it serves');
}

// ---------------------------------------------------------------- the hub
console.log('the hub');
{
  const motion = place(S.SPAWN_POSITION.x, S.SPAWN_POSITION.y, S.SPAWN_POSITION.z);
  walk(motion, { moveX: 0, moveZ: 1, jump: false, sprint: false, cameraYaw: 0 }, 5.5);
  check(motion.grounded && motion.z > S.COURSE.lobbyEndZ + 5, `walking forward from spawn passes the gate onto stage 1's runway (z ${motion.z.toFixed(0)})`);
  // And a sprint through the gate lands on the same runway, faster.
  const sprinter = place(S.SPAWN_POSITION.x, S.SPAWN_POSITION.y, S.SPAWN_POSITION.z);
  walk(sprinter, { moveX: 0, moveZ: 1, jump: false, sprint: true, cameraYaw: 0 }, 3.2);
  check(sprinter.grounded && sprinter.z > motion.z - 20 && sprinter.z < S.STAGES[0].startZ + 26, `a sprint covers the hub in three seconds (z ${sprinter.z.toFixed(0)})`);
}
{
  // Onto treadmill 2 from the side, walking +Z from the open deck, then a
  // moment to settle: the rails are a low kerb, walked over rather than hopped.
  const z0 = S.treadmillZ(2) - 12;
  const motion = place(S.treadmillX(2), 1, z0);
  walk(motion, { moveX: 0, moveZ: 1, jump: false, sprint: false, cameraYaw: 0 }, 0.9);
  walk(motion, { moveX: 0, moveZ: 0, jump: false, sprint: false, cameraYaw: 0 }, 0.3);
  check(motion.treadmill === 2 && motion.grounded, `walking onto a belt from its side is detected (belt ${motion.treadmill} at z ${motion.z.toFixed(1)})`);
  walk(motion, { moveX: 0, moveZ: 0, jump: false, sprint: false, cameraYaw: 0 }, 1);
  check(motion.treadmill === 2, 'standing still on the belt stays on the belt');
  walk(motion, { moveX: 0, moveZ: 1, jump: false, sprint: false, cameraYaw: 0 }, 1);
  check(motion.treadmill === 0, 'walking off the far side leaves it');
  check(S.treadmillAt(0, 0, -78) === 0, 'the spawn is not a treadmill');
  check(S.TREADMILL_COUNT === 3, 'three treadmills');
}
{
  // Up the back stairway to the top terrace, walking +X.
  // Thirty-five units of +X from the floor in front of the terraces reaches the
  // middle of the top deck; further would walk off its far edge.
  const motion = place(36, 0, S.UPGRADE_ROWS.stairZ[0]);
  walk(motion, { moveX: -1, moveZ: 0, jump: false, sprint: false, cameraYaw: 0 }, 2.2);
  check(motion.grounded && Math.abs(motion.y - S.UPGRADE_ROWS.rowY[2]) < 0.05, `the stairs are walked to the top terrace (y ${motion.y.toFixed(2)} at x ${motion.x.toFixed(0)})`);
  const front = place(36, 0, S.UPGRADE_ROWS.stairZ[1]);
  walk(front, { moveX: -1, moveZ: 0, jump: false, sprint: false, cameraYaw: 0 }, 2.2);
  check(front.grounded && Math.abs(front.y - S.UPGRADE_ROWS.rowY[2]) < 0.05, 'and so is the front stairway');
}
{
  let standable = true;
  for (const tier of S.SPEED_UPGRADES) {
    const x = S.upgradeTileX(tier.slot);
    const z = S.upgradeTileZ(tier.slot);
    const top = S.upgradeTileY(tier.slot) + S.UPGRADE_ROWS.tileHeight;
    const found = collision.surfaceYAt(x, z, top);
    if (found === null || Math.abs(found - top) > 1e-6) standable = false;
    if (S.upgradeTileAt(x, top, z) !== tier.slot) standable = false;
  }
  check(standable, 'all fifteen upgrade tiles can be stood on and are detected');
  check(S.upgradeTileAt(0, 0, -78) === null, 'the spawn is not a tile');
}

// --------------------------------------------------------------- the pads
console.log('win pads');
{
  let ok = true;
  for (const stage of S.STAGES) {
    const win = S.winPadAt(stage.winPadX, stage.padY, stage.winPadZ);
    const floor = collision.surfaceYAt(stage.winPadX, stage.winPadZ, stage.padY);
    if (win?.index !== stage.index) ok = false;
    if (floor === null || Math.abs(floor - stage.padY) > 1e-6) ok = false;
    if (stage.winPadX <= 0) ok = false;
  }
  check(ok, 'every win pad is on the LEFT, stood on and detected');
  check(S.COURSE_SOLIDS.every((s) => s.kind !== 'returnPad'), 'nothing stands beside a win pad: the return pads are gone');
  check(S.winPadAt(0, 0, -78) === null, 'the spawn is not a win pad');
}

// ------------------------------------------------------------- the boards
console.log('boards');
{
  const behindSpawn = S.BOARDS.z < S.SPAWN_POSITION.z && S.BOARDS.z > S.COURSE.lobbyStartZ;
  const onBackWall = S.BOARDS.z - S.COURSE.lobbyStartZ < 12;
  const inside = S.BOARDS.x.every((x) => Math.abs(x) + S.BOARDS.width / 2 < S.COURSE.lobbyHalfWidth - 6);
  check(behindSpawn && onBackWall && inside, `the three boards stand on the back wall behind the spawn (z ${S.BOARDS.z}, x ${S.BOARDS.x.join('/')})`);
  check(S.BOARDS.x.length === 3, 'three boards, and only there');
}

// ------------------------------------------------------------- the killers
console.log('hazards');
{
  check(S.COURSE_HAZARDS.every((h) => h.z > S.COURSE.lobbyEndZ), 'no hazard in the hub');
  check(S.COURSE_HAZARDS.every((h) => {
    const stage = S.STAGES[h.stage - 1];
    return stage && h.z >= stage.startZ && h.z <= stage.endZ;
  }), 'every hazard sits inside its own stage');
  const at = { x: 0, y: 0, z: 0 };
  let finite = true;
  for (const h of S.COURSE_HAZARDS) {
    for (const t of [0, 1.7, 33.3, 1000]) {
      S.hazardPositionAt(h, t, at);
      if (![at.x, at.y, at.z].every(Number.isFinite)) finite = false;
      const reach = S.hazardReachX(h);
      if (Math.abs(at.x) > reach + 1e-6) finite = false;
    }
  }
  check(finite, 'every hazard position is finite and inside its declared reach');
  check(S.QUICKSAND.length > 0 && S.STAGES.every((s) => S.quicksandAt(0, (s.startZ + s.endZ) / 2) !== null), 'every stage has a cloud sea under it');
  check(S.STAGES.every((s) => {
    const pit = S.quicksandAt(0, (s.startZ + s.endZ) / 2);
    return pit && pit.deathY < s.startY - 5 && pit.deathY < s.endY - 5;
  }), 'the sea is well below every stage floor');
  // A fall from a stage floor into the sea is a death.
  const stage = S.STAGES[1];
  const pit = S.quicksandAt(0, stage.startZ + 60);
  check(collision.hasFallen(0, pit.deathY - 0.1, stage.startZ + 60), 'falling into the sea kills');
  check(!collision.hasFallen(0, stage.startY, stage.startZ + 5), 'standing on the runway does not');
  check(S.SINKING_SOLIDS.every((p) => {
    const up = S.sinkingOffsetAt(p, p.steady * 0.5 - p.phase);
    const down = S.sinkingOffsetAt(p, p.steady + p.warn + 0.45 + p.sunk * 0.5 - p.phase);
    return up.drop === 0 && down.drop === p.depth;
  }), 'every fading cloud is up for its steady phase and gone when sunk');
}

// -------------------------------------------------------------- the end
console.log('the end of the world');
{
  const out = { x: 0, z: 0 };
  collision.clampToBounds(0, S.COURSE_END_Z + 500, out);
  check(out.z === S.COURSE_END_Z, 'nothing goes past the last apron');
  collision.clampToBounds(500, -78, out);
  check(out.x === S.COURSE.lobbyHalfWidth, 'the hub is bounded');
  collision.clampToBounds(500, 400, out);
  check(out.x === S.corridorHalfWidthAt(400), 'the course is bounded');
}

console.log('');
console.log(failures === 0 ? 'course OK' : `${failures} problem(s) found`);
process.exit(failures === 0 ? 0 : 1);
