# +1 Godspeed Escape

Browser multiplayer divine sprint obby: Three.js client, Colyseus server, npm workspaces
(`shared` / `server` / `client`). Technical reference for patterns: `D:\+1 Speed Robot Escape`
(NOT the moonwalk project).

## Commands

```bash
npm run dev                 # builds shared, then server (tsx watch, :2575) + Vite client (:5181)
npm run build               # shared + server + client (client/dist)
npm run typecheck           # all workspaces
npm run verify              # verify:course + verify:progression + verify:assets
npm run verify:capacity     # needs a running server on :2575; joins 18 clients, expects 15-per-room routing
npm run size:client         # client/dist size against the 12 MB budget
```

Do NOT use python from the Bash tool on this machine (Windows Store stub stalls). Use node/sed/perl.

## Non-negotiable rules

- Ports: server **2575**, Vite **5181**, preview 4181. Room name `godspeedescape`, Bloxity slug `godspeed-escape`.
- **Client build must stay under 12 MB.** No world image files: world textures are canvas-drawn (`client/src/world/WorldTextures.ts`). Only `assets/` (audio, UI icons, player model) ship as files; `scripts/verify-assets.mjs` pins their digests.
- **Sprint is HOLD Q only** (touch: hold the SPRINT button). No toggle. Energy drains while held, regens only after release (`shared/src/config/sprint.ts`, `PlayerSim.applySprint`).
- **Wins are SPENT on Speed Upgrades, Trails, Auras and Charms** (the unlock is a purchase: `wallet.spend`, after every other check has passed). The 15 upgrade thresholds in `shared/src/config/upgrades.ts` are exact from the spec (note +512 = 12,000,000 then +1K = 10,000,000: intentional, preserve).
- **Speed (the progression number) is earned per STEP** (`SPEED.strideDistance`), not per second. Rate = `(upgrade.speedPerStep + trailBonus) × rebirth × aura × charms` via `speedPerStepFor`. Treadmills pay belt distance while the player stands still.
- **No checkpoints.** Any death respawns at the main spawn. Every stage has exactly one cloud/storm/void sea under it (`seaFor` in `course.ts`); the sea kills, nothing else is a soft landing.
- Level curve, rebirth levels `[15,45,75,110,150,200]`, and `MAX_LEVEL 200` are fixed; keep the anchors level 10 = 245, 11 = 264, 12 = 284.
- The course is pure data in `shared/src/config/course.ts`; the server and client both read it. After ANY course edit run `npm run verify:course` (walkability, gaps vs run reach, launch pads, hub layout, seas, bounds).
- Charm shop: 3 random charms, restock every 5 minutes, server-side singleton (`CharmService.charmShop`), replicated as an encoded shelf string plus `restockIn`.
- Effects budget for remotes: `VISIBLE_REMOTE_PLAYERS` / `FULL_EFFECT_REMOTE_PLAYERS` in the client. Do not simulate full god-power particles for every remote.
- Server is authoritative; the client predicts with `stepPlayer` and reconciles. Any change to `PlayerMotion` must be reflected in reconciliation (sprint energy is part of it).

## Progress and identity (persistence rules)

- **Storage is per key** (`server/src/persistence/`): `get / put / insertIfAbsent / loadAll / flush`, one document per player. `MONGODB_URI` set → `MongoStorage` (Legion's managed database, the db named in the URI, official `mongodb` driver, hoisted to the root `node_modules`). Unset → `JsonStorage` (`profiles.json` + `grants.json`, atomic temp+fsync+rename, leftover `.tmp` recovered, unparseable file MOVED ASIDE, never overwritten). Never write a whole-map snapshot to Mongo; `$set` only known fields, `$unset` only `displayName`/`avatarUrl`; unknown fields are preserved.
- **A profile is read from storage at join time** (`onAuth`), never from the boot cache. The cache in `ProfileStore` is for leaderboards only. A failed read THROWS and the join is refused with code 4105; the client retries. Never seat a player on an empty profile.
- **Identity = the portal token, verified with Bloxity** (`server/src/auth/BloxityAuth.ts`): `POST https://api.bloxity.io/v1/auth/game-token/verify`, `Authorization: Bearer <token>`, body `{ gameSlug }`. Host is a constant. Only a 2xx with a valid string `_id` verifies. Outcomes: verified / rejected (guest, cached 30 s) / unavailable (guest for now, re-verified on a backoff, never cached). Never trust a browser-supplied account id anywhere, including Bux fulfilment. Never verify the JWT locally (`JWT_SECRET` is the game's secret, not Bloxity's key).
- **Keys**: account `bloxity:<accountId>` (`accountKeyFor`), guest = browser id. A browser id with the `bloxity:` prefix is refused (4104).
- **First login**: account profile wins; else migrate real guest progress with `insertIfAbsent` (+`migratedFrom`), then retire the guest (`migratedTo`, `migratedAt`, `migratedSnapshot`, progress reset). Retired guests are never migrated again and are excluded from leaderboards. Use LIVE session state when signing in mid-session.
- **Mid-session login change** is a `SetAuth` message on the live session (`CourseRoom.switchAuth`): hold autosaves, save the leaving profile (stay put if it cannot land), resolve the new one, re-run the join's service order, pay grants, place at spawn, save. Only the newest login counts; one arriving mid-switch is queued.
- **Purchases**: the webhook records to storage (200 only once durable, 503 otherwise); rooms `claim` atomically (lease), add Wins, save, then `settle`. SKU values unchanged.
- **Shutdown**: `gracefullyShutdown(false)`, then `profileStore.flush()` and `close()`.
- **Boot never fails on Mongo being down**; `/health` keeps answering.
- Test with `npm run verify:persistence` (not part of `verify`); it stubs ONLY the Bloxity verify URL via `node --import scripts/persistence/stub-bloxity.mjs`.

## Layout facts

- Spawn faces +Z. Treadmills are on the player's RIGHT (−X), the three-row Speed Upgrade terraces on the LEFT (+X), the three leaderboards (Wins / Rebirths / Time) on the BACK wall behind the spawn (z ≈ -142, x -32/0/32), facing the course.
- Treadmill console solid sits at the +X head of each belt: players enter belts from the side.
- Course: 12 stages from z 0 to ≈ 2733, climbing to y ≈ 106; win pad on the LEFT of each finish apron and nothing beside it (the blue return pads were removed).

## Verification before calling anything done

`npm run typecheck && npm run verify && npm run build:client && npm run size:client`, then
`npm run verify:capacity` against a running dev server, and `npm run verify:persistence` after
any change to auth, persistence, the room's join/leave/switch paths or the webhook.
