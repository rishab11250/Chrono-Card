# Deployment handoff

Public deployment was deferred by the owner during implementation. No hosted URL, cloud account, or public smoke test is claimed. Everything below is ready to run when the target host is chosen.

## Option 1: One server serves everything

This is the simplest setup. Express serves the Vite build and Socket.IO from the same origin, so `VITE_SERVER_URL` is unnecessary.

1. Use Node 22.13 or newer on a host that supports a long-running process and WebSockets.
2. Build with `npm ci && npm run build`; start with `npm start`.
3. Set `CLIENT_ORIGIN` to the exact public HTTPS origin, such as `https://chrono-card.example.com`, without a trailing slash. `PORT` is supplied by most hosts.
4. Supply `REDIS_URL` for restart recovery. Standard `redis://` and TLS `rediss://` URLs work. The URL must be a Redis protocol endpoint, not an HTTP/REST endpoint.
5. Mount persistent storage and set `DATA_DIR` to its directory. SQLite stores accounts, run receipts, replays, and daily scores there. Without a persistent disk, those records are lost when the instance is replaced.
6. Use `/api/health` as the health check. `storage: "memory"` means Redis is not configured. A Redis connection or write failure returns 503.
7. Set `NODE_ENV=production` and a private `AUTH_SECRET` of at least 32 bytes. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it stable across restarts; changing it signs everyone out. Production refuses to start without it. Development generates an ephemeral key when omitted.
8. Set `TRUST_PROXY_HOPS` to the exact number of trusted proxies in front of Express (default 0; Render template 1). Do not enable blanket proxy trust: rate limits depend on the client IP.

`render.yaml` supplies a single Render web service with a SQLite disk. Review its paid-plan/disk settings before applying; it is a configuration template, not an existing deployment. Provide `CLIENT_ORIGIN` and `REDIS_URL` in the dashboard. There is no cloud credential checked into the repository.

For a self-hosted setup:

```sh
docker compose up --build
```

Set `AUTH_SECRET` in your shell or Compose `.env` before this command. Compose requires it; Render generates its own private secret automatically.

Open `http://localhost:3001`. Compose runs Redis with append-only persistence and gives the app a SQLite volume. For a public domain, change `CLIENT_ORIGIN`, terminate HTTPS at your reverse proxy, and forward WebSocket upgrade headers. Keep Redis on the private network.

## Option 2: Vercel client + Render/Railway server

1. Deploy the Node server first, using the build/start commands above.
2. Import the repository in Vercel with the repository root as its root directory. The checked-in `vercel.json` builds `@chrono/client` and publishes `packages/client/dist`.
3. Set Vercel's build-time `VITE_SERVER_URL` to the server's HTTPS origin. Rebuild when this value changes.
4. Set the server's `CLIENT_ORIGIN` to the final client origin. Multiple explicit origins are comma-separated; no wildcard credentials or blanket production CORS setting is used.
5. If preview deployments need online play, explicitly add their origins. Unlisted origins are rejected for both Socket.IO polling and WebSocket handshakes.

The static client cannot host Socket.IO or SQLite in a serverless function. Local solo and couch play work even if the live server is down; online modes and daily scoring need the Node server.

## Local environment files

The server reads environment variables but does not silently load `.env`. To use the root `.env.example` as a starting point, create a `.env`, build, then run:

```sh
node --env-file=.env packages/server/dist/index.js
```

For development, export the server variables before `npm run dev`. Vite reads client variables from `packages/client/.env.local`; all `VITE_` values are public, so never put secrets there.

## Operational boundaries

- Run **one instance**. The in-process room map has one authoritative owner. Redis snapshots do not make simultaneous writers or horizontal autoscaling safe.
- Room snapshots expire after two hours without activity. Disconnected players get a 90-second grace period; if it expires, their explorer forfeits and the party continues.
- After a server restart, rooms are loaded lazily by code and previously connected players receive a fresh reconnect window. Both browser sessions need their original private tokens.
- Tokens are sent only in private create/join/resume acknowledgements (or an HTTP create response), never in broadcast room views. They live in per-tab session storage. Invite and spectator URLs contain only public room codes.
- An HTTP client can `POST /api/rooms` with JSON `{ "name": "Ada", "mode": "party" }`, then attach via `room:resume` using the returned session. HTTP room creation is limited to ten requests per minute per connection IP. Socket events have a per-connection limit.
- Daily leaderboard names are anonymous, but scores are server-verified: a score is inserted only after an authoritative daily win. Online account run statistics require the completed room's private player capability; run receipts prevent double counting. Offline personal statistics remain self-reported and must not be used as competitive rankings.
- Accounts use asynchronous scrypt password hashing and expiring signed bearer tokens. Authentication writes are rate-limited. Browser account tokens remain in local storage; avoid untrusted scripts and keep HTTPS enabled. There is no payment flow.
- Redis startup has a ten-second connection deadline. A failed queued write makes health unhealthy; later writes can recover instead of leaving the queue permanently rejected. Room snapshots include submitted simultaneous plans.
- Back up SQLite consistently, including its WAL, before upgrading. The audit migration adds a run-receipt table and a case-insensitive unique username index. Existing case-colliding names cause an actionable startup error: resolve ownership manually in a backup-reviewed migration, never delete accounts automatically. Retain a pre-upgrade backup for rollback. Existing tokens from the old signing key are intentionally invalidated.

## Public smoke test checklist

- [ ] `/api/health` returns 200 with the intended storage backend.
- [ ] Client loads over HTTPS without mixed-content or CORS errors.
- [ ] A solo expedition starts, plays a card, and survives refresh.
- [ ] Couch co-op alternates both players before enemy resolution.
- [ ] Two separate devices join the same online room and take turns.
- [ ] A spectator link renders the same state without enabling actions.
- [ ] Refresh an active player's tab and confirm its turn/HP/hand are restored.
- [ ] Briefly disconnect a device and verify the 90-second hold; verify forfeiture after expiry.
- [ ] Finish a daily run, check the leaderboard, and confirm it survives a server restart.
- [ ] Complete a multiplayer escape through all three Acts (twelve rooms per route).
- [ ] Submit simultaneous turns on both devices, refresh one after submission, and confirm the next round resolves once.
- [ ] Register, sign in, restart the server, and confirm account access with the stable signing key.
- [ ] Add the final client/server URLs to the submission documentation.
