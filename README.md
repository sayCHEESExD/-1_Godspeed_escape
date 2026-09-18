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

Player profiles are a JSON file under `GODSPEED_DATA_DIR`. Legion pods scale to zero and keep no
disk, so progression on Bloxity lasts only as long as a pod does until persistence is moved to the
`MONGODB_URI` Legion injects.

### Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `PORT`, `HOST` | server | Listen address (default 2575 / 0.0.0.0). `--port N` overrides. |
| `GODSPEED_DATA_DIR` | server | Profile storage directory (default `data/`). |
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
terraces left of spawn. Wins are never spent on them. Each tier has its own god-power effect that
shows mainly while sprinting.

**Sprint** (hold Q) boosts speed while a visible energy bar drains. Release to refill quickly.
Running the bar dry locks sprint until it recovers.

**Backpack**: Trails (19 tiers, flat Speed bonus, Wins gates), Auras (6 tiers, 1.5x to 25x
multipliers, Wins gates) and Charms (bought with Wins in the Charm Shop, which restocks
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
