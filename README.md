# Chrono Card

A tactical dungeon crawler where your hand is your movement. Choose a route through 15 authored rooms across three Acts, draft new cards, and escape solo, on the same screen with a friend, or in a live party of up to four players. Enemies announce their attacks before they land.

## Run locally

Requires Node.js **22.13+** and npm. Redis is optional for local development.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. The game server runs on port **3001**; Vite proxies HTTP and Socket.IO requests. Solo and couch co-op work without a server. Local runs save automatically in the browser. Online sessions survive refresh in the same tab.

For the production build, including a server that serves the client:

```sh
npm run build
npm start
```

Open **http://localhost:3001**. Production and Docker require a private `AUTH_SECRET` of at least 32 bytes. For a persistent Docker setup, configure that secret and use `docker compose up --build`. Public deployment is intentionally deferred at the owner's request; see [deployment instructions](docs/deployment.md).

## Play

- Select a card, then a highlighted tile. You get **two plays per turn**. Redraw costs no play.
- **Red outlines** strike next round; **purple outlines** show an elite's two-round charge. Small circles mark planned movement. Enemies attack, then move, after every living player has taken a turn. Bombers mark a tile in gold before leaving three-round embers that hurt only on entry.
- Clear all enemies to unlock the exit. At each non-final exit, every explorer drafts one of three seeded cards. At forks, choose one of two described paths; they reunite before the Act boss. Reach the final Act's exit to win (a route visits 12 of the 15 authored rooms).
- Draft Rift hop, Petal storm, Clockwork dart, Dew of dawn, or Ember forge. Forge permanently upgrades Iron edge to Iron edge+ for this run. Dart costs no play but all copies share a two-round cooldown.
- Grey cards have **no valid targets right now**, but remain selectable. This is a preview, not deck filtering: every fresh hand still guarantees a movement and attack card. The same status is available to keyboard and screen-reader users.
- Hazards deal 1 damage when entered. Dash skips intermediate hazards and crosses actors, but its landing tile must be free.
- Each player has 12 HP. Entering a room restores 3 HP and revives fallen teammates. An abandoned online player stays out. The party loses when everyone falls.
- In online mode, share the six-character room code or invite link. Spectator links grant view-only access. A disconnected player has **90 seconds** to resume before forfeiting.
- The daily challenge runs on the server with a shared UTC seed. Completed runs rank by turns, then elapsed time.

**Keyboard:** `1`–`5` select cards, `E` ends the turn, `Esc` cancels selection, `?` opens instructions. Tab to the board; arrow keys move tile focus and Enter selects. Touch controls use the same card-then-tile flow. On phones, the hand scrolls horizontally.

## Workspace

| Package           | Responsibility                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Typed state, JSON cards/enemies/levels, seeded RNG, pure immutable rules, legal-target previews             |
| `packages/client` | Phaser 3 board, responsive DOM hand/HUD/dialogs, accessible tile controls, Socket.IO reconnect client       |
| `packages/server` | Express HTTP, authoritative Socket.IO rooms, private reconnect tokens, Redis snapshots, SQLite daily scores |
| `tests`           | Rules, legal playthrough bot, real socket integration, persistence, Chromium UI checks                      |
| `docs`            | Rules decisions, timeline completion map, deployment guide, two-page submission PDF and source              |

Online clients send intentions and state revisions. Only the server resolves online gameplay. Solo/co-op run the same shared engine locally. Enemy telegraphs stay fixed throughout a round, including after a swap; taunt is the explicit exception.

## Verify

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
npm run docs:pdf
```

Browser tests use `/usr/bin/chromium` by default here. Elsewhere, run `npx playwright install chromium` and set `PLAYWRIGHT_BUNDLED_CHROMIUM=1`, or set `CHROMIUM_PATH` to an installed browser. Set `TEST_REDIS_URL` to a disposable local/test Redis instance to enable the restart-recovery test; CI supplies one. It uses unique room keys, never flushes the database, and expires its own data.

`npm run docs:pdf` generates [the two-page submission](docs/chrono-card-submission.pdf) from [its HTML source](docs/submission.html). The prompt log records actual user instructions and labels the assistant's implementation decisions separately.

## Runtime configuration

See [.env.example](.env.example). No secrets are embedded in the client.

| Variable           | Used by      | Meaning                                                                     |
| ------------------ | ------------ | --------------------------------------------------------------------------- |
| `PORT`             | Server       | HTTP/WebSocket port, default 3001                                           |
| `AUTH_SECRET`      | Server       | Private signing key, at least 32 bytes; required in production              |
| `TRUST_PROXY_HOPS` | Server       | Exact trusted reverse-proxy hop count, default 0                            |
| `CLIENT_ORIGIN`    | Server       | Comma-separated allowed browser origins, without trailing slashes           |
| `REDIS_URL`        | Server       | Optional Redis/Redis TLS connection URL; missing means in-memory rooms      |
| `DATA_DIR`         | Server       | Directory for `chrono.sqlite`; mount persistent storage in production       |
| `VITE_SERVER_URL`  | Client build | Public server origin; omit for same-origin hosting or the development proxy |

The server does not implicitly load `.env` files. Export variables, configure your host, or invoke Node with `--env-file=.env` as explained in the deployment guide. Vite loads its usual `packages/client/.env.local` at build time.

## Scope and constraints

See the [repository audit](docs/repo-audit.md) for security, persistence, simultaneous-play fixes, regression coverage, and remaining operational limits.

The three-Act expansion adds graph-based routes, deterministic drafts, six new card IDs, six enemy kinds, and explicit threat budgets. See [mechanics and authoring notes](docs/progression.md). Upstream's authentication/profile, ghost replay, cosmetics, and tracked sprite rendering are retained. The original submission PDF describes the earlier milestone; this README and the mechanics notes describe the expanded game.

The server is designed for **one long-lived instance**; Redis provides reconnect/restart snapshots, not distributed room ownership. Do not scale it horizontally without a shared lock/ownership design and a Socket.IO adapter. Daily scores identify a run/name. Hosting and the final public-link smoke test remain deferred at the owner's request.

Artwork is original palette-limited pixel art, shared between Phaser sprites and SVG inventory portraits. The handheld-era interface uses locally bundled Press Start 2P and VT323 fonts; their OFL licenses are included in `packages/client/public/fonts`. The design skill guided the cohesive game screen, inventory panels, pixel hearts, and readable telegraphs. Each dungeon has its own palette, with animated flames, floating enemies, fireflies, defeat sparks, and damage feedback. Reduced-motion preferences disable these animations. Desktop places the command deck beside the world; mobile uses a horizontal card inventory below it.
