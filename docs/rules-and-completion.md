# Rules decisions and delivery map

The source requirements are the two documents supplied in the parent workspace: `chrono-card-prd.md` and `chrono-card-timeline.md`. This file records the decisions the PRD left open and maps the implementation to the timeline without claiming deployment has happened.

## Launch rules

| Decision       | Implementation                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid / rooms   | Five JSON-defined 10×10 rooms. Three original enemy types; one extra enemy per additional explorer.                                                                                                                         |
| Hand / economy | Five cards; two plays per turn. Each new hand guarantees a movement and attack card. Remaining cards are discarded at the next draw; the deck recycles deterministically. Redraw is free but requires an available play.    |
| Party health   | Separate 12-HP pools. Loss occurs only when all explorers fall. Entering a room heals 3 HP and revives fallen allies to 3 HP. Forfeited players never revive.                                                               |
| Turn order     | Alternating players in all modes; enemies resolve after all living players. This is a deliberate choice over simultaneous resolution for clarity and reliability.                                                           |
| Telegraphs     | Each enemy stores its announced attack coordinates and optional move. It attacks those exact tiles, then attempts that move. No retargeting halfway through the party round. Taunt explicitly changes one announced attack. |
| Movement       | Cardinal lines. Step I: one tile; Step II: up to two; dash: up to three. Walls always block; dash may cross actors. Movement may not end on an occupied tile.                                                               |
| Swap           | Any adjacent floor/hazard/actor tile, or any living ally. Swapped enemies retain their announced attack coordinates.                                                                                                        |
| Combat         | Strike and lance deal two damage; enemies have two HP. Lance requires a clear cardinal line of at most two tiles. Shields block one hit, do not stack, and expire when entering a room.                                     |
| Support        | Boost gives a living ally one extra play next turn, up to two stored bonuses. Taunt moves one enemy's next attack to the user's current tile; the user may then escape it.                                                  |
| Exit           | All enemies must be defeated before the exit works. Any living party member can advance the whole party. The fifth exit wins.                                                                                               |
| Network        | A server validates every action, turn, target, hand index, and revision. Host-only start; 2–4 online players, dedicated two-person rooms, read-only spectators.                                                             |
| Reconnect      | Private per-player token in session storage; 90-second grace. On expiry the missing explorer forfeits and is skipped. Room snapshots expire after two hours.                                                                |
| Daily          | UTC date seed fixes deck shuffles and enemy headings on the five authored layouts. Server-resolved solo run; completed scores sorted by turns, then elapsed seconds.                                                        |

## Timeline coverage

| Timeline steps                                        | Delivered                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–8: types, engine skeleton, content, rendering, hand | npm/TypeScript workspaces; shared data and immutable engine; Phaser grid; card hand.                                                                         |
| 9–16: cards, rooms, outcomes, HUD                     | Ten card effects, enemy telegraphs, HP/shields, five authored rooms, win/loss overlays and progress.                                                         |
| 17: first solo deployment                             | Deferred by owner. Local and production builds are playable.                                                                                                 |
| 18–19: content and solo tuning                        | All five rooms; guaranteed movement/damage draws, healing/revival, legal end-to-end bot playthroughs.                                                        |
| 20–24: server, network, duo rules                     | Express room/health APIs, Socket.IO wrapper, authoritative engine, typed protocol, Redis snapshots, documented duo decisions.                                |
| 25–30: lobbies, larger parties, reconnect, tuning     | Create/join/share, host control, couch and online duo, 2–4 players, session restore, expiry handling, validation tests, multi-browser playtests.             |
| 31: final public hosting                              | Deferred by owner. Render/Vercel/Docker configuration and deployment checklist supplied.                                                                     |
| 32: local full-build playtest                         | Automated legal full runs in solo, duo, and party; real four-player socket run with spectator; browser tests for solo/co-op/daily/reconnect/mobile/keyboard. |
| 33: submission document                               | `docs/submission.html`, editable HTML source, truthful prompt log.                                                                                           |
| 34: fun feature                                       | Spectator links and server-scored daily challenge with SQLite leaderboard.                                                                                   |
| 35: hosted smoke test                                 | Pending public deployment. Explicit checklist in `docs/deployment.md`.                                                                                       |

## Optional ideas outside launch scope

Async ghost allies, cosmetic unlocks, shared-HP toggles, simultaneous turns, account identity, horizontal server scaling, and a drag interaction are not necessary for the selected launch scope. The PRD permits click-to-play and requires at least one extra feature; two extra features ship here. No UI control advertises an unimplemented feature.

## Verification

Rules tests exercise each card, hazards, fixed telegraphs, deck conservation, legality/immutability, co-op ordering, room transitions, revival/forfeiture, win/loss, and seeded replay. Full legal-play bots complete the authored dungeon. Socket tests cover authority, public/private state separation, stale revisions, spectator restrictions, reconnect expiry, HTTP creation, four-player completion, and daily score insertion. Persistence tests reopen SQLite and recover a live room after a Redis-backed server restart. Browser tests exercise visible controls in independent sessions and a 390px mobile viewport.

These checks verify the scripted scenarios. Human balance testing with the eventual team and a hosted two-device smoke test are still useful before judging; no automated test substitutes for deployment on the eventual network.
