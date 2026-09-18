/**
 * PERSISTENCE, checked end to end against the BUILT server.
 *
 * Spawns `server/dist/index.js` with Bloxity's token verify route stubbed
 * (scripts/persistence/stub-bloxity.mjs, preloaded with `node --import`;
 * production code is untouched), joins it with real colyseus.js clients, and
 * reads the storage directly to prove what landed.
 *
 * Runs against the JSON store ALWAYS, in a temp directory.
 *
 * Runs against MongoDB too when one is available:
 *
 *   - MONGODB_URI=mongodb://host/db   uses that database and  * * WIPES IT * *
 *     (every collection is dropped before the suite). Never point it at a
 *     database you care about.
 *   - otherwise, if a `mongod` binary is found (MONGOD_BIN, or the one
 *     mongodb-memory-server caches under ~/.cache/mongodb-binaries), a real
 *     mongod is started on a fixed port with a temp dbPath and is killed and
 *     restarted for the outage tests. The binary lives OUTSIDE the repo.
 *   - otherwise the Mongo suite is skipped, loudly.
 *
 * Usage: npm run verify:persistence
 */
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'colyseus.js';
import { ACCOUNT_KEY_PREFIX, ROOM_NAME, accountKeyFor } from '../shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const STUB = pathToFileURL(path.join(ROOT, 'scripts', 'persistence', 'stub-bloxity.mjs')).href;
const GAME_SLUG = 'godspeed-escape';
const PORT = 2595;
const MONGO_PORT = 27117;
const WINDOWS = platform() === 'win32';

if (!existsSync(SERVER_ENTRY)) {
  console.error(`server/dist is missing - run "npm run build:server" first (${SERVER_ENTRY})`);
  process.exit(1);
}

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => console.log(`  ok    ${message}`);
const check = (condition, message) => (condition ? pass(message) : fail(message));
const note = (message) => console.log(`        ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A STALL WATCHDOG. Every step names itself; if no step completes for two
 * minutes the run is aborted with the name of the one it was in, so a hang
 * is a diagnosis rather than a silent process.
 */
let currentStep = 'starting';
let lastProgress = Date.now();
const step = (label) => {
  currentStep = label;
  lastProgress = Date.now();
  if (process.env.VERBOSE) note(`-> ${label}`);
};
setInterval(() => {
  if (Date.now() - lastProgress > 120_000) {
    console.error(`\npersistence: STALLED for 120s in step "${currentStep}"`);
    process.exit(2);
  }
}, 5000).unref();

const waitFor = async (probe, label, timeoutMs = 10_000, everyMs = 60) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await probe();
    } catch {
      value = undefined;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(everyMs);
  }
};

// ------------------------------------------------------------- the server

/** A spawned test server: its port, its log, and a hard stop. */
class TestServer {
  constructor(proc, port) {
    this.proc = proc;
    this.port = port;
    this.lines = [];
    this.exited = new Promise((resolve) => proc.once('exit', resolve));
    for (const stream of [proc.stdout, proc.stderr]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        rest += chunk;
        const parts = rest.split('\n');
        rest = parts.pop() ?? '';
        this.lines.push(...parts);
        // SERVER_LOG=<file> keeps every test server's output for a post-mortem.
        if (process.env.SERVER_LOG) appendFileSync(process.env.SERVER_LOG, parts.map((l) => `[${port}] ${l}\n`).join(''));
      });
    }
  }

  get log() {
    return this.lines.join('\n');
  }

  /**
   * Stop the server. On Windows a signal never reaches a Node handler, so it
   * is killed hard; every test that needs a write to survive waits for the
   * write to be visible in storage BEFORE calling this. Elsewhere a SIGTERM
   * exercises the graceful path (drain, flush, close).
   */
  async stop({ graceful = !WINDOWS } = {}) {
    if (this.proc.exitCode !== null) return;
    if (graceful) {
      this.proc.kill('SIGTERM');
      const finished = await Promise.race([this.exited.then(() => true), sleep(15_000).then(() => false)]);
      if (finished) return;
      note('graceful stop timed out; killing');
    }
    this.proc.kill('SIGKILL');
    await this.exited;
  }
}

const health = async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return response.ok ? response.json() : null;
};

const startServer = async ({ dataDir, mongoUri = '', port = PORT, slug = GAME_SLUG, stubSlug = GAME_SLUG }) => {
  const proc = spawn(process.execPath, ['--import', STUB, SERVER_ENTRY, '--port', String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      GODSPEED_DATA_DIR: dataDir,
      MONGODB_URI: mongoUri,
      BLOXITY_GAME_ID: slug,
      STUB_GAME_SLUG: stubSlug,
      HOST: '127.0.0.1',
      PORT: '',
      POD_NAME: `test-pod-${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = new TestServer(proc, port);
  try {
    await waitFor(() => health(port), `server on ${port}`, 30_000, 100);
  } catch (error) {
    console.error(server.log);
    throw error;
  }
  return server;
};

// ------------------------------------------------------------- the client

const endpoint = (port) => `ws://127.0.0.1:${port}`;

/** Join the room as a browser (guest id) with an optional portal token. */
const joinAs = async (port, { playerId, token = null, name } = {}) => {
  const client = new Client(endpoint(port));
  const options = { playerId, token };
  if (name) options.identity = { displayName: name, avatarUrl: '' };
  const room = await client.joinOrCreate(ROOM_NAME, options);
  room.authStates = [];
  room.onMessage('authState', (message) => room.authStates.push(message));
  room.onMessage('respawn', () => {});
  room.onMessage('stageAwarded', () => {});
  await waitFor(() => room.state?.players?.get(room.sessionId), 'own player state');
  return room;
};

/** A join that is expected to be REFUSED. Returns the error code, or null if it got in. */
const joinRefused = async (port, options) => {
  try {
    const room = await joinAs(port, options);
    await room.leave();
    return null;
  } catch (error) {
    return error?.code ?? -1;
  }
};

const me = (room) => room.state.players.get(room.sessionId);

/**
 * State arrives by PATCH on the room's clock while a message is sent at once,
 * so a figure is asserted once the next patch has carried it, not the instant
 * the message landed.
 */
const settled = (room, predicate, label) =>
  waitFor(() => (predicate(me(room)) ? true : null), label, 4000, 40).then(
    () => true,
    () => false,
  );

/** Earn some Speed the only way there is: by MOVING. Returns the new total. */
const earn = async (room, seconds = 1.2) => {
  const before = me(room).totalSpeed;
  let seq = room.nextSeq ?? 1;
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i += 1) {
    room.send('move', { seq: seq++, dt: 0.05, moveX: 0, moveZ: 1, jump: false, sprint: false, cameraYaw: 0 });
    await sleep(50);
  }
  room.nextSeq = seq;
  await waitFor(() => me(room).totalSpeed > before, 'Speed to be credited', 8000);
  // Back to spawn, so the next stretch of running does not walk off the hub.
  room.send('requestRespawn', {});
  await sleep(150);
  return me(room).totalSpeed;
};

const setAuth = async (room, token, expectStatus) => {
  const seen = room.authStates.length;
  room.send('setAuth', { token });
  return waitFor(
    () => room.authStates.slice(seen).find((m) => (expectStatus ? m.status === expectStatus : true)),
    `authState ${expectStatus ?? ''}`.trim(),
    15_000,
  );
};

const leaveAndWait = async (room) => {
  await room.leave(true);
  await sleep(150);
};

const webhook = async (port, body) => {
  const response = await fetch(`http://127.0.0.1:${port}/bloxity/bux`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

// ------------------------------------------------------------- the storage

/** Direct readers for each store, so a test proves what LANDED, not what a client saw. */
class JsonReader {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }
  readProfiles() {
    const file = path.join(this.dataDir, 'profiles.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }
  readGrants() {
    const file = path.join(this.dataDir, 'grants.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }
  async close() {}
}

class MongoReader {
  constructor(uri) {
    this.uri = uri;
  }
  async open() {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 3000 });
    await this.client.connect();
    this.db = this.client.db();
  }
  async wipe() {
    await this.db.dropDatabase();
  }
  async readProfiles() {
    const out = {};
    for (const doc of await this.db.collection('profiles').find({}).toArray()) {
      const { _id, ...rest } = doc;
      out[_id] = rest;
    }
    return out;
  }
  async readGrants() {
    const out = {};
    for (const doc of await this.db.collection('grants').find({}).toArray()) {
      const { _id, ...rest } = doc;
      out[_id] = rest;
    }
    return out;
  }
  async close() {
    await this.client?.close();
  }
}

const profileOf = async (reader, key) => (await reader.readProfiles())[key] ?? null;
const waitForProfile = (reader, key, predicate, label) =>
  waitFor(async () => {
    const profile = await profileOf(reader, key);
    return profile && predicate(profile) ? profile : null;
  }, label, 12_000, 100);

const PROGRESS_KEYS = [
  'totalSpeed', 'wins', 'ownedUpgrades', 'rebirths', 'ownedTrails', 'trailSlot',
  'ownedAuras', 'auraSlot', 'ownedCharms', 'equippedCharms', 'bestStage', 'playSeconds',
];
const sameProgress = (a, b) => PROGRESS_KEYS.every((k) => (a?.[k] ?? 0) === (b?.[k] ?? 0));

// ------------------------------------------------------------- mongod

const findMongod = () => {
  if (process.env.MONGOD_BIN && existsSync(process.env.MONGOD_BIN)) return process.env.MONGOD_BIN;
  const cache = path.join(homedir(), '.cache', 'mongodb-binaries');
  if (!existsSync(cache)) return null;
  const bin = readdirSync(cache).find((f) => f.startsWith('mongod'));
  return bin ? path.join(cache, bin) : null;
};

class Mongod {
  constructor(binary, dbPath, port) {
    this.binary = binary;
    this.dbPath = dbPath;
    this.port = port;
    this.uri = `mongodb://127.0.0.1:${port}/godspeed_verify`;
  }
  async start() {
    mkdirSync(this.dbPath, { recursive: true });
    this.proc = spawn(this.binary, ['--port', String(this.port), '--dbpath', this.dbPath, '--bind_ip', '127.0.0.1', '--quiet'], {
      stdio: 'ignore',
    });
    this.exited = new Promise((resolve) => this.proc.once('exit', resolve));
    const { MongoClient } = await import('mongodb');
    await waitFor(async () => {
      const client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 500 });
      try {
        await client.connect();
        await client.db().command({ ping: 1 });
        return true;
      } finally {
        await client.close().catch(() => {});
      }
    }, `mongod on ${this.port}`, 40_000, 250);
  }
  async stop() {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.proc.kill('SIGKILL');
    await this.exited;
    // Let the port go before a restart binds it again.
    await sleep(WINDOWS ? 800 : 200);
  }
}

// ------------------------------------------------------------- the suite

/**
 * The scenarios every store must pass. `ctx` carries the store's reader and
 * a way to (re)start the server against it.
 */
const runSuite = async (ctx) => {
  const { reader, kind } = ctx;
  const server = { current: await ctx.startServer() };
  const restart = async () => {
    await server.current.stop();
    server.current = await ctx.startServer();
  };
  const port = () => server.current.port;

  const acct = 'acct1';
  const acctKey = accountKeyFor(acct);
  const bad = new Set();
  const badToken = 'valid:'; // no id after the colon: the stub rejects it

  console.log(`\n${kind}: guests`);
  {
    const g = await joinAs(port(), { playerId: 'p_guest1', name: 'GuestOne' });
    const t1 = await earn(g);
    await leaveAndWait(g);
    const stored = await waitForProfile(reader, 'p_guest1', (p) => p.totalSpeed >= t1, 'guest save');
    check(stored.displayName === 'GuestOne', 'the guest save keeps its display name');
    const again = await joinAs(port(), { playerId: 'p_guest1' });
    check(me(again).totalSpeed === stored.totalSpeed, `existing guest profile restores (totalSpeed ${stored.totalSpeed})`);
    await leaveAndWait(again);
    ctx.guestProgress = stored;
  }

  console.log(`\n${kind}: first login migrates`);
  {
    const before = await profileOf(reader, 'p_guest1');
    const s = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    check(me(s).totalSpeed === before.totalSpeed, 'the session carries the guest progress into the account');
    const account = await waitForProfile(reader, acctKey, () => true, 'account profile');
    check(sameProgress(account, before), 'every progress field is preserved in the account profile');
    check(account.migratedFrom === 'p_guest1', 'account profile records migratedFrom');
    const guest = await waitForProfile(reader, 'p_guest1', (p) => p.migratedTo === acctKey, 'retired guest');
    check(guest.migratedSnapshot?.totalSpeed === before.totalSpeed, 'the guest copy keeps its progress as migratedSnapshot');
    check(guest.totalSpeed === 0, 'the retired guest profile is fresh');
    const more = await earn(s);
    check(more > before.totalSpeed, 'the signed-in session keeps earning');
    await leaveAndWait(s);
    const after = await waitForProfile(reader, acctKey, (p) => p.totalSpeed >= more, 'account save after playing');
    check((await profileOf(reader, 'p_guest1')).totalSpeed === 0, 'account play does not touch the retired guest');
    ctx.accountTotal = after.totalSpeed;
    bad.add(server.current.log.includes(`join`) ? '' : 'no join log');
  }

  console.log(`\n${kind}: nothing leaks to a claimed id`);
  {
    check((await joinRefused(port(), { playerId: `${ACCOUNT_KEY_PREFIX}${acct}` })) === 4104, 'a guest id with the account prefix is refused');
    const raw = await joinAs(port(), { playerId: acct });
    check(me(raw).totalSpeed === 0, 'a raw account id as a browser id gets a fresh guest, nothing more');
    await leaveAndWait(raw);
    const forged = await joinAs(port(), { playerId: 'p_forger', token: `forged:${acct}` });
    check(me(forged).totalSpeed === 0, 'a forged token gets a fresh guest, nothing more');
    await leaveAndWait(forged);
    const noid = await joinAs(port(), { playerId: 'p_noid', token: `noid:${acct}` });
    check(me(noid).totalSpeed === 0 && server.current.log.includes('carried no usable _id'), 'a 2xx without an _id does not verify');
    await leaveAndWait(noid);
    check((await joinRefused(port(), { playerId: 'p_bad', token: badToken })) === null, 'a rejected token still lets the player in as a guest');
  }

  console.log(`\n${kind}: sign-out and sign-in on the live session`);
  {
    const s = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    check(me(s).totalSpeed === ctx.accountTotal, 'reconnecting as the same account restores it');
    const out = await setAuth(s, null, 'guest');
    check(out.status === 'guest' && (await settled(s, (p) => p.totalSpeed === 0, 'fresh guest state')), 'logout -> guest, fresh because this browser was migrated');
    const guestBit = await earn(s, 0.8);
    const back = await setAuth(s, `valid:${acct}`, 'account');
    check(back.status === 'account' && (await settled(s, (p) => p.totalSpeed === ctx.accountTotal, 'account state')), 'signing back in restores the account');
    // The switch saved the guest it LEFT from live state before loading the account.
    const guest = await waitForProfile(reader, 'p_guest1', (p) => p.totalSpeed >= guestBit, 'the leaving guest save');
    check(guest.migratedTo === acctKey && guest.totalSpeed >= guestBit, 'the retired guest is not migrated a second time');
    check((await profileOf(reader, acctKey)).totalSpeed === ctx.accountTotal, 'guest play never reached the account');
    await leaveAndWait(s);
  }

  console.log(`\n${kind}: the same account elsewhere`);
  {
    const other = await joinAs(port(), { playerId: 'p_browser2', token: `bare:${acct}` });
    check(me(other).totalSpeed === ctx.accountTotal, 'the same account on another browser sees the same progress');
    await leaveAndWait(other);
    check((await profileOf(reader, 'p_browser2')) === null, 'that browser gained no guest profile of its own');
  }

  console.log(`\n${kind}: an existing account is never overwritten`);
  {
    const g3 = await joinAs(port(), { playerId: 'p_guest3' });
    const t3 = await earn(g3);
    await leaveAndWait(g3);
    await waitForProfile(reader, 'p_guest3', (p) => p.totalSpeed >= t3, 'guest3 save');
    const s = await joinAs(port(), { playerId: 'p_guest3', token: `valid:${acct}` });
    check(me(s).totalSpeed === ctx.accountTotal, 'the account wins over the browser profile');
    const guest3 = await profileOf(reader, 'p_guest3');
    check(guest3.totalSpeed >= t3 && !guest3.migratedTo, 'the browser profile is left untouched and not retired');
    const out = await setAuth(s, null, 'guest');
    check(out.status === 'guest' && (await settled(s, (p) => p.totalSpeed === guest3.totalSpeed, 'guest3 state')), "logout returns that browser's own progress");
    await leaveAndWait(s);
  }

  console.log(`\n${kind}: purchases`);
  {
    const first = await webhook(port(), { transactionId: 'tx-1', userId: acct, sku: 'wins_small', username: 'user_acct1' });
    check(first.status === 200 && first.body?.ok === true, 'the webhook answers 200 once the grant is recorded');
    const dup = await webhook(port(), { transactionId: 'tx-1', userId: acct, sku: 'wins_small' });
    check(dup.status === 200 && dup.body?.duplicate === true, 'a retried webhook is a duplicate, not a second payout');
    const impostor = await joinAs(port(), { playerId: acct });
    await sleep(400);
    check(me(impostor).wins === 0, 'a guest using the account id as a browser id is paid nothing');
    await leaveAndWait(impostor);
    const winsBefore = (await profileOf(reader, acctKey)).wins;
    const s = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    await waitFor(() => me(s).wins === winsBefore + 250, 'the grant to be paid on join', 8000);
    pass('a recorded purchase is paid to the verified account on join (+250)');
    await waitForProfile(reader, acctKey, (p) => p.wins === winsBefore + 250, 'account save with the grant');
    const settledGrant = await waitFor(async () => (await reader.readGrants())['tx-1']?.appliedAt ? true : null, 'tx-1 to be settled', 8000).catch(() => false);
    check(settledGrant === true, 'the grant is marked applied once the save landed');
    await leaveAndWait(s);

    const second = await webhook(port(), { transactionId: 'tx-2', userId: acct, sku: 'wins_large' });
    check(second.status === 200, 'a second purchase is recorded');
    await waitFor(async () => (await reader.readGrants())['tx-2'], 'tx-2 to be durable');
    await restart();
    const again = await joinAs(port(), { playerId: 'p_guest1', token: `valid:${acct}` });
    await waitFor(() => me(again).wins === winsBefore + 250 + 1500, 'the grant to survive the restart', 8000);
    pass('a purchase recorded before a restart is paid after it (+1500)');
    await waitForProfile(reader, acctKey, (p) => p.wins === winsBefore + 250 + 1500, 'account save after the restart grant');
    await leaveAndWait(again);
    ctx.accountWins = winsBefore + 250 + 1500;
  }

  console.log(`\n${kind}: Bloxity unavailable`);
  {
    const s = await joinAs(port(), { playerId: 'p_outage', token: 'down:acct9' });
    check(me(s).totalSpeed === 0 && server.current.log.includes('bloxity unavailable, will re-ask'), 'a token Bloxity cannot answer for is let in as a guest and re-asked later');
    await leaveAndWait(s);
    const h = await joinAs(port(), { playerId: 'p_outage2', token: 'neterr:acct9' });
    check(me(h).totalSpeed === 0, 'a network error verifying is a guest too');
    await leaveAndWait(h);
  }

  console.log(`\n${kind}: a server restart loses nothing`);
  {
    const g = await joinAs(port(), { playerId: 'p_restart' });
    const t = await earn(g);
    await leaveAndWait(g);
    await waitForProfile(reader, 'p_restart', (p) => p.totalSpeed >= t, 'save before restart');
    const accountBefore = await profileOf(reader, acctKey);
    await restart();
    const again = await joinAs(port(), { playerId: 'p_restart' });
    check(me(again).totalSpeed >= t, 'a guest profile survives a server restart');
    await leaveAndWait(again);
    const s = await joinAs(port(), { playerId: 'p_browser2', token: `valid:${acct}` });
    check(me(s).totalSpeed === accountBefore.totalSpeed && me(s).wins === accountBefore.wins, 'an account profile survives a server restart');
    await leaveAndWait(s);
  }

  console.log(`\n${kind}: the wrong game`);
  {
    await server.current.stop();
    server.current = await ctx.startServer({ slug: 'another-game' });
    const s = await joinAs(port(), { playerId: 'p_wrong', token: `valid:${acct}` });
    check(me(s).totalSpeed === 0 && server.current.log.includes('rejected (401 GAME_TOKEN_INVALID)'), 'a token for another game slug is rejected by the verify route');
    await leaveAndWait(s);
    await server.current.stop();
    server.current = await ctx.startServer();
  }

  ctx.server = server;
  return server;
};

/** JSON-only: the file on disk. */
const runJsonExtras = async (ctx, server) => {
  const { reader, dataDir } = ctx;
  console.log('\njson: a corrupt file is moved aside');
  {
    const before = await reader.readProfiles();
    await server.current.stop();
    const file = path.join(dataDir, 'profiles.json');
    const garbage = '{ this is not json' + readFileSync(file, 'utf8');
    writeFileSync(file, garbage);
    server.current = await ctx.startServer();
    const aside = readdirSync(dataDir).find((f) => f.startsWith('profiles.json.corrupt-'));
    check(Boolean(aside), 'the unreadable file is moved aside');
    check(aside && readFileSync(path.join(dataDir, aside), 'utf8') === garbage, 'the moved-aside file keeps its bytes intact');
    const g = await joinAs(port(server), { playerId: 'p_after_corrupt' });
    await earn(g, 0.6);
    await leaveAndWait(g);
    await waitForProfile(reader, 'p_after_corrupt', (p) => p.totalSpeed > 0, 'a save after the move-aside');
    check(!existsSync(path.join(dataDir, 'profiles.json.tmp')), 'no temp file is left behind');
    // Put the good data back for the log scan below to stay meaningful.
    await server.current.stop();
    writeFileSync(file, JSON.stringify(before));
    server.current = await ctx.startServer();
  }
};

const port = (server) => server.current.port;

/** Mongo-only: outages, the queued save, the legacy import. */
const runMongoExtras = async (ctx, server, mongod) => {
  const { reader } = ctx;
  const acct = 'acct1';
  const acctKey = accountKeyFor(acct);

  console.log('\nmongo: the database goes down');
  {
    step('outage: join as the account');
    const s = await joinAs(port(server), { playerId: 'p_browser2', token: `valid:${acct}` });
    const total = me(s).totalSpeed;
    step('outage: stop mongod');
    await reader.close();
    await mongod.stop();
    check((await health(port(server)))?.ok === true, '/health still answers while the database is down');
    const code = await joinRefused(port(server), { playerId: 'p_during_outage' });
    check(code === 4105, `a join during the outage is REFUSED (code ${code}), never seated on a fresh profile`);
    step('outage: sign-out while down');
    const stay = await setAuth(s, null);
    const stayed = stay.status === 'account' && /staying/.test(stay.note ?? '') && me(s).totalSpeed === total;
    check(stayed, 'a sign-out that cannot reach storage stays on the account');
    if (!stayed) {
      note(`authState=${JSON.stringify(stay)} total=${total} now=${me(s).totalSpeed}`);
      for (const line of server.current.lines.slice(-12)) note(line);
    }
    step('outage: earn while down');
    const more = await earn(s, 0.8);
    step('outage: leave while down');
    await leaveAndWait(s); // queues a save the database cannot take yet
    step('outage: restart mongod');
    await mongod.start();
    await reader.open();
    step('outage: wait for the queued save');
    const landed = await waitForProfile(reader, acctKey, (p) => p.totalSpeed >= more, 'the queued save to land once the database is back', 40_000);
    check(landed.totalSpeed >= more, 'a save made during the outage lands once the database is back');
    const again = await joinAs(port(server), { playerId: 'p_browser2', token: `valid:${acct}` });
    check(me(again).totalSpeed === landed.totalSpeed && me(again).wins === ctx.accountWins, 'everything is intact after the outage');
    const out = await setAuth(again, null, 'guest');
    const wentThrough = out.status === 'guest' && (await settled(again, (p) => p.totalSpeed === 0, 'guest after outage'));
    check(wentThrough, 'and the sign-out goes through now');
    if (!wentThrough) {
      note(`authState=${JSON.stringify(out)} now=${me(again).totalSpeed} guestDoc=${JSON.stringify(await profileOf(reader, 'p_browser2'))}`);
      for (const line of server.current.lines.slice(-12)) note(line);
    }
    await leaveAndWait(again);
  }

  console.log('\nmongo: the legacy JSON file is imported, insert-only');
  {
    const account = await profileOf(reader, acctKey);
    const legacy = {
      legacy_player: { ...ctx.guestProgress, totalSpeed: 777, wins: 7, displayName: 'Legacy', updatedAt: 1 },
      [acctKey]: { ...account, totalSpeed: 1, wins: 1, displayName: 'MUST NOT WIN', updatedAt: Date.now() + 1e9 },
    };
    writeFileSync(path.join(ctx.dataDir, 'profiles.json'), JSON.stringify(legacy));
    await server.current.stop();
    server.current = await ctx.startServer();
    await sleep(300);
    const imported = await profileOf(reader, 'legacy_player');
    check(imported?.totalSpeed === 777 && imported?.wins === 7, 'a profile only the legacy file knew is added');
    const kept = await profileOf(reader, acctKey);
    check(kept.totalSpeed === account.totalSpeed && kept.displayName !== 'MUST NOT WIN', 'an existing account profile is never overwritten by the import');
    check(server.current.log.includes('legacy import'), 'the import is logged');
  }
};

const scanLog = (label, log) => {
  const bad = log.split('\n').filter((line) => /UnhandledPromiseRejection|unhandledRejection|uncaughtException|TypeError|ReferenceError|RangeError/.test(line));
  check(bad.length === 0, `${label}: no unhandled errors in the server log`);
  for (const line of bad.slice(0, 10)) note(line);
};

// ------------------------------------------------------------- run

const run = async () => {
  const stamp = Date.now();
  const logs = [];

  // ---- JSON store (ONLY=mongo skips it while iterating on the Mongo half)
  if (process.env.ONLY !== 'mongo') {
    const dataDir = mkdtempSync(path.join(tmpdir(), `godspeed-json-${stamp}-`));
    const reader = new JsonReader(dataDir);
    const ctx = {
      kind: 'json',
      reader,
      dataDir,
      startServer: (overrides = {}) => startServer({ dataDir, ...overrides }),
    };
    console.log(`json store in ${dataDir}`);
    const server = await runSuite(ctx);
    await runJsonExtras(ctx, server);
    logs.push(['json', server.current.log]);
    await server.current.stop();
    scanLog('json', logs.map(([, l]) => l).join('\n'));
    rmSync(dataDir, { recursive: true, force: true });
  }

  // ---- Mongo store
  let mongod = null;
  let uri = process.env.MONGODB_URI ?? '';
  if (!uri) {
    const binary = findMongod();
    if (binary) {
      mongod = new Mongod(binary, mkdtempSync(path.join(tmpdir(), `godspeed-mongod-${stamp}-`)), MONGO_PORT);
      console.log(`\nstarting mongod from ${binary}`);
      await mongod.start();
      uri = mongod.uri;
    }
  }
  if (!uri) {
    console.log('\nmongo: SKIPPED - set MONGODB_URI (it will be WIPED) or MONGOD_BIN to run the Mongo suite');
  } else {
    const dataDir = mkdtempSync(path.join(tmpdir(), `godspeed-mongo-${stamp}-`));
    const reader = new MongoReader(uri);
    await reader.open();
    console.log(`\nWIPING the test database at ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
    await reader.wipe();
    const ctx = {
      kind: 'mongo',
      reader,
      dataDir,
      startServer: (overrides = {}) => startServer({ dataDir, mongoUri: uri, ...overrides }),
    };
    const server = await runSuite(ctx);
    if (mongod) await runMongoExtras(ctx, server, mongod);
    else console.log('\nmongo: outage tests SKIPPED (no local mongod to kill; MONGODB_URI points at a server this script does not own)');
    const log = server.current.log;
    await server.current.stop();
    await reader.close();
    scanLog('mongo', log);
    if (mongod) await mongod.stop();
    rmSync(dataDir, { recursive: true, force: true });
    if (mongod) rmSync(mongod.dbPath, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\npersistence OK' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('\npersistence: ABORTED -', error?.stack ?? error);
  process.exit(1);
});
