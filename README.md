# Chrono Card

A tactical dungeon crawler where your hand is your movement. Play an entire five-room expedition solo, pass the screen to a friend, or coordinate in a live party of up to four players. Enemies announce their next attack before you commit a card.

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

Open **http://localhost:3001**. For a persistent Docker setup, use `docker compose up --build` instead. Public deployment is intentionally deferred at the owner's request; see [deployment instructions](docs/deployment.md).

## Play

- Select a card, then a highlighted tile. You get **two plays per turn**. Redraw costs no play.
- **Red outlines** are the exact tiles enemies will attack next; small circles mark planned movement. Enemies attack, then move, after every living player has taken a turn.
- Clear all enemies to unlock the exit. Reach the exit in the fifth room to win.
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

| Variable          | Used by      | Meaning                                                                     |
| ----------------- | ------------ | --------------------------------------------------------------------------- |
| `PORT`            | Server       | HTTP/WebSocket port, default 3001                                           |
| `CLIENT_ORIGIN`   | Server       | Comma-separated allowed browser origins, without trailing slashes           |
| `REDIS_URL`       | Server       | Optional Redis/Redis TLS connection URL; missing means in-memory rooms      |
| `DATA_DIR`        | Server       | Directory for `chrono.sqlite`; mount persistent storage in production       |
| `VITE_SERVER_URL` | Client build | Public server origin; omit for same-origin hosting or the development proxy |

The server does not implicitly load `.env` files. Export variables, configure your host, or invoke Node with `--env-file=.env` as explained in the deployment guide. Vite loads its usual `packages/client/.env.local` at build time.

## Scope and constraints

All core game modes, five-room content, spectator links, daily challenges, score persistence, tests, and PDF are implemented. Ghost replays and cosmetic unlocks are optional PRD ideas and are not included. The server is designed for **one long-lived instance**; Redis provides reconnect/restart snapshots, not distributed room ownership. Do not scale it horizontally without a shared lock/ownership design and a Socket.IO adapter. Scores identify an anonymous run/name, not a verified account. Hosting and the final public-link smoke test remain for deployment.

Artwork is original palette-limited pixel art, shared between Phaser sprites and SVG inventory portraits. The handheld-era interface uses locally bundled Press Start 2P and VT323 fonts; their OFL licenses are included in `packages/client/public/fonts`. The design skill guided the cohesive game screen, inventory panels, pixel hearts, and readable telegraphs. Each dungeon has its own palette, with animated flames, floating enemies, fireflies, defeat sparks, and damage feedback. Reduced-motion preferences disable these animations. Desktop places the command deck beside the world; mobile uses a horizontal card inventory below it.
