# +1 Godspeed Escape

A browser multiplayer obby with god powers. Run and sprint through a floating Olympus course,
earn **Speed** with every step, level up, rebirth for permanent multipliers, and use **Wins**
from the course to unlock stronger divine upgrades, trails and auras.

- Three.js client, Colyseus server, shared TypeScript simulation.
- Up to **15 players per room**, overflow opens a new room automatically.
- Desktop (WASD, Space, **hold Q to sprint**) and mobile (joystick, JUMP, hold SPRINT).
- Bloxity identity, avatar and display name; persistent profiles.
- Production client build ≈ 2.6 MB (12 MB budget).

## Run it

Requires Node 20.11+.

```bash
npm install
npm run dev
```

Open http://localhost:5181. The server listens on ws://localhost:2575 (`/health` reports rooms and players).

## Build

```bash
npm run build          # shared + server + client
npm run size:client    # measures client/dist against the 12 MB budget
npm start              # runs the built server
```

`Dockerfile` builds the server image; `netlify.toml` builds the static client (set
`VITE_SERVER_URL` to the public `wss://` server address).

## Deployment (Bloxity Hosting)

The game is registered on [Bloxity Hosting](https://hosting.bloxity.io) as **`godspeed-escape`**.
Deploying is pushing a branch; `.github/workflows/deploy.yml` does both halves of a release.

| Branch | Channel | Backend (Colyseus)                        | Frontend (static client)                  |
| ------ | ------- | ----------------------------------------- | ----------------------------------------- |
| `dev`  | dev     | `wss://godspeed-escape.dev.host.bloxity.io` | `https://godspeed-escape.dev.play.bloxity.io` |
| `main` | prod    | `wss://godspeed-escape.host.bloxity.io`     | `https://godspeed-escape.play.bloxity.io`     |

- **Server**: the `Dockerfile` is built from the repository root (the server imports the
  `shared` workspace), pushed to GHCR as `ghcr.io/<owner>/godspeed-escape-server:<channel>-<sha>`,
  and rolled with the documented Legion call, `POST https://legion.bloxity.io/v1/apps/godspeed-escape/deploy`
  with `{channel, image, version, seatCap: 15, maxReplicas: 5}`. The commit SHA is the version.
  Legion injects `PORT`; the server reads it and answers `GET /health`.
- **Client**: built with `VITE_SERVER_URL` set to the channel's backend above and
  `VITE_BLOXITY_GAME_ID=godspeed-escape`, zipped from inside `client/dist` so `index.html` is at the
  archive root, and uploaded as the raw body of
  `POST https://api.bloxity.io/v1/hosting/games/godspeed-escape/frontend?channel=<channel>&version=<sha>`.

The only secret is **`LEGION_DEPLOY_TOKEN`** (repository Settings → Secrets and variables → Actions),
copied from My Games on hosting.bloxity.io. The API hosts and routes are the documented ones and are
written out in the workflow; no repository variables are needed.

One-time after the first push: make the GHCR package `godspeed-escape-server` public
(repository → Packages → Package settings → Change visibility) so Legion can pull it.

## Player progress

Progress is **per account** for signed-in Bloxity players and **per browser** for guests.

- **Storage.** With `MONGODB_URI` set (every Legion pod: an isolated managed database per game
  and channel), profiles live in MongoDB, one document per player, written per key with
  idempotent upserts so several pods can share the database. Without it (a laptop, the
  verification scripts) profiles live in `GODSPEED_DATA_DIR/profiles.json`, written atomically.
  A `profiles.json` found beside a Mongo deployment is imported on boot, insert-only.
  Progress therefore survives restarts, idle scale-to-zero and deploys.
- **Who you are.** The client sends the portal's game **token** (never an account id) at join
  and whenever the login changes. The server asks Bloxity
  (`POST https://api.bloxity.io/v1/auth/game-token/verify` with `{ gameSlug }`) and keys the
  profile `bloxity:<accountId>` only for a 2xx carrying a valid `_id`. A rejected token plays as
  a guest; an unreachable Bloxity plays as a guest for now and is re-asked on a backoff.
  Guest profiles are keyed by the browser's own id; a browser id carrying the `bloxity:` prefix
  is refused.
- **First login.** If the account has a profile it always wins. If it has none and this browser's
  guest has real progress, that progress becomes the account's (insert-only, so two pods racing
  create one profile), and the guest copy is retired: reset, marked `migratedTo`, its old
  progress kept as `migratedSnapshot`. A retired guest is never migrated again.
- **Sign-in / sign-out mid-session** switches the live session's profile: the profile being left
  is saved from live state first, then the new one is loaded and the player is placed at spawn.
  If storage cannot be reached the session stays on its current profile.
- **Outages.** A join while storage is unreachable is refused (code 4105) and the client keeps
  retrying; nobody is seated on an empty profile. Saves queue and land once storage is back.
  `/health` keeps answering.
- **Purchases.** The Bux webhook records each transaction durably (answering 200 only then, 503
  if it cannot), keyed by transaction id so a retry pays once. Rooms claim grants atomically for
  the verified account, add the Wins, save, and only then mark them applied.

Verify all of it against the built server with `npm run verify:persistence` (JSON store always;
MongoDB when a `mongod` binary or `MONGODB_URI` is available - the latter is **wiped**).

### Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `PORT`, `HOST` | server | Listen address (default 2575 / 0.0.0.0). `--port N` overrides. |
| `MONGODB_URI` | server | Injected by Legion. When set, profiles and grants live in this MongoDB database. |
| `GODSPEED_DATA_DIR` | server | The JSON store when `MONGODB_URI` is unset (default `data/`); a legacy `profiles.json` here is imported into Mongo on boot. |
| `BLOXITY_GAME_ID` | server | Injected by Legion. The slug tokens are verified against (default `godspeed-escape`). |
| `BLOXITY_WEBHOOK_SECRET` | server | Shared secret for the Bloxity fulfilment webhook. Set in production. |
| `VITE_SERVER_URL` | client | Game server URL baked in at build time. |
| `VITE_BLOXITY_GAME_ID` | client | Bloxity game id override. |
| `VITE_DEBUG=1` | client | Debug overlays in a production build. |

## How the game works

**Speed** is earned per step: on the ground, on a treadmill (the belt moves, you do not), and
while sprinting. Each step pays `(upgrade + trail bonus) × rebirth × aura × charms`.

**Levels** follow a smooth curve up to level 200 (level 10 needs 245 Speed, 11 needs 264, 12 needs 284).

**Rebirth** resets level and Speed for a permanent multiplier: 1.5x, 2x, then +0.5x each.
Available at level 15, 45, 75, 110, 150 and 200. Unlocks and cosmetics are kept.

**Wins** come from the course. Each of the 12 stages has a win pad paying 1, 3, 10, 30, 100, 300,
1,000, 3,000, 10,000, 30,000, 100,000 and 500,000 Wins, then returns you to spawn. Falling
respawns at spawn with no checkpoints.

**Speed Upgrades** (15 tiers, +1 to +16K per step) are unlocked by holding enough Wins on the
terraces left of spawn. The Wins are spent on the unlock. Each tier has its own god-power effect that
shows mainly while sprinting.

**Sprint** (hold Q) boosts speed while a visible energy bar drains. Release to refill quickly.
Running the bar dry locks sprint until it recovers.

**Backpack**: Trails (19 tiers, flat Speed bonus, bought with Wins), Auras (6 tiers, 1.5x to 25x
multipliers, bought with Wins) and Charms (bought with Wins in the Charm Shop, which restocks
3 random charms every 5 minutes).

## Project layout

```
shared/   simulation, course data, progression config (single source of truth)
server/   Colyseus room, services (speed, upgrades, trails, auras, charms, rebirth, leaderboards), persistence
client/   Three.js world, effects, HUD/panels, input, networking, Bloxity integration
assets/   audio, UI icons, player model (served via Vite publicDir)
scripts/  verification: course walkability, progression math, asset digests, build size, room capacity
```

## Verification

```bash
npm run typecheck
npm run verify              # course + progression + assets
npm run verify:capacity     # with the dev server running
npm run build:client && npm run size:client
```
