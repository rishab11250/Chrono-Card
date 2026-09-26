# Expedition depth

## Room graphs

`packages/shared/src/levels.json` contains Acts with an `entry` room ID and room `next` edges. Edges stay inside an Act. A terminal room advances to the next Act's entry; the final Act's terminal exit wins. `LEVELS` remains a flat adapter for board dimensions, rendering, and saved room indices, not the progression rule.

Each Act currently has five authored rooms: entry → either of two branches → reunion → boss. A route visits four rooms per Act, twelve overall. Room `choiceDescription` text hints at a safer-looking or treasure-lined route; it does not secretly change difficulty. Add rooms by editing the graph, not an index switch. Graph tests check reachability and cycles. Playthrough bounds and final-room assertions use `LEVELS.length`.

Clear all enemies and reach the exit to begin rewards. Each non-abandoned explorer, including a fallen teammate who will revive, chooses one card before travel. Then the party's living chooser selects a route when two are offered. There is no draft after the final victory.

## Authoritative actions and saves

- `draft-card { cardId }`: accepted only from the active drafter and only for one of their three offers. Adds one card to that explorer's discard pile. Repeated or forged picks are rejected.
- `choose-room { roomId }`: accepted only from the active chooser and only for an offered successor.
- Offers, picks, cooldowns, temporary hazards, visited rooms, and pending room choices live in shared game state. The seeded RNG generates all offers and encounters; no client-only random reward decisions exist.
- Socket requests retain revision checks and strict validation. Intermission choices bypass simultaneous combat queues and resolve through `applyAction`, just like local play. Spectators see choices but cannot submit them.
- A forfeiting chooser hands control to another eligible explorer without advancing the enemy round. Closing a choice dialog does not skip rewards: the command deck provides a reopen button. Local saves retain a pending draft or route choice across refresh.

## Enemy warning contract

Every fresh attack is shown for at least a full party round before resolution. Attack coordinates stay fixed during the warning (the existing Challenge card explicitly redirects a warning).

| Kind           | HP  | Threat | Behavior                                                           |
| -------------- | --- | ------ | ------------------------------------------------------------------ |
| Seeker         | 2   | 1      | Adjacent attack, then pursues                                      |
| Warden         | 2   | 1      | Adjacent attack, then patrols                                      |
| Sentinel       | 2   | 2      | Stationary rotating beam                                           |
| Cinder Bomber  | 2   | 2      | Stationary; marks an explorer's tile, then drops embers next round |
| Eclipse Seeker | 4   | 3      | Double-HP Seeker with a two-round charge                           |
| Chrono Warden  | 4   | 4      | Two-round wide-cross charge; Act boss                              |

For elites, `EnemyIntent.charging: true` means two rounds until resolution. The first enemy phase changes it to false without attacking, moving, or retargeting. The next phase resolves those same coordinates. Board labels show `CHARGE 2` then `READY 1`; tile labels announce the same timing.

Bombs do no direct damage on placement. Their temporary `~` tiles use the existing one-damage-on-entry rule, last three playable rounds, and expire at round boundaries. Dropping again on the same tile renews its lifetime. Bombers do not cover exits. Temporary hazards clear on room entry; authored hazard tiles remain.

## Draft cards

| Card           | Effect                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Rift hop       | Teleport within Manhattan distance 2, including across walls; landing must be free and landing hazards still hurt   |
| Petal storm    | Target yourself to deal 2 damage to every orthogonally adjacent enemy, without friendly fire                        |
| Clockwork dart | Clear straight-line attack up to 3 tiles, 1 damage, zero plays; all copies share a cooldown until current round + 2 |
| Dew of dawn    | Restore 3 HP to an injured living explorer, capped at maximum HP                                                    |
| Ember forge    | Target yourself to permanently upgrade the first Iron edge found in hand, draw pile, then discard                   |
| Iron edge+     | Forged version: 3 adjacent damage; created by Forge, not offered directly                                           |

Three distinct offers come from the five draftable cards after every non-final room. Forge does not remove a card or change deck size. The player's movement/attack guarantee searches their customized deck and discard by category, never by position or current legal targets. Cooldowns survive travel and are expressed in shared round numbers.

## Difficulty budgets

Enemy threat values are in `enemies.json`. Each Act declares `difficulty.baseThreat`, `threatPerDepth`, `threatPerAlly`, its eligible `pool`, and `boss`.

`target = baseThreat + longest graph depth × threatPerDepth + (party size − 1) × threatPerAlly`

Current Act base threats are 3, 4, and 5; depth and each additional non-abandoned teammate add 1. Terminal rooms reserve the boss's threat first. Seeded selection fills the remainder exactly from affordable enemies, then places them on distinct floor tiles outside the starting party area. The content must include a one-threat enemy to fill any remainder and enough free floor space. Tests verify exact totals for every room, several seeds, and solo/duo/four-player parties.

## Client-only previews and phones

The hand computes `legalTargets(game, index)` for every card, caching by immutable state identity to avoid recomputing when only focus changes. A no-target card has a grey treatment and text status but remains selectable on your turn; a hand that is not yours remains disabled. Selection descriptions, tile labels, and the accessible grid provide the same no-target signal. No draw-pool filtering or engine changes were made in the Step 6 commit.

Phone controls use tap-card, tap-tile. Swiping the hand does not start card dragging. Controls have larger touch targets, small-screen headers wrap, choice dialogs scroll within the viewport, and rectangular boards preserve alignment between the canvas and accessible grid after rotation. Mouse dragging and keyboard shortcuts remain available.

## Verification

Each requested implementation step passed `npm run typecheck && npm run lint && npx vitest run` before the next step. Coverage includes legal full-run bots, real socket party and daily runs, graph choices, forfeits, deterministic drafts, upgrades, cooldowns, damage timing, and exact encounter budgets. Browser coverage includes desktop, online/spectator refresh, 320px/390px phones, portrait/landscape rotation, draft recovery, and keyboard-accessible no-target previews.

The local Redis recovery test is conditional on `TEST_REDIS_URL`; CI provides Redis. Visual screenshots are spot checks, not baseline visual-regression certification. Automated label and keyboard tests are not a substitute for a manual screen-reader audit. Public hosting is not part of this delivery.
