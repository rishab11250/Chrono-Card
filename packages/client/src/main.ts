import './style.css';
import './progression.css';
import './phone.css';
import {
  activePlayer,
  ACTS,
  applyAction,
  CARDS,
  createGame,
  ENEMIES,
  legalTargets,
  LEVELS,
  same,
  tileAt,
  type GameAction,
  type CardId,
  type GameState,
  type LeaderboardEntry,
  type Position,
  type RoomView,
  type UserProfile,
} from '@chrono/shared';
import { API_URL, Network } from './net';
import { icon } from './icons';
import { auth } from './auth';

type Board = {
  update: (state: GameState, targets: Position[]) => void;
  destroy: () => void;
};
let boardInstance: Board | null = null;
let boardLoading: Promise<Board> | null = null;

interface Achievement {
  id: string;
  name: string;
  description: string;
  check: (game: GameState) => boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'speed_clear',
    name: 'Chrono Rush',
    description: 'Clear a room in under 10 turns.',
    check: (g) =>
      g.phase === 'playing' &&
      g.turns < 10 &&
      g.enemies.length === 0 &&
      g.level > 0,
  },
  {
    id: 'no_damage',
    name: 'Untouchable',
    description: 'Win without taking any damage.',
    check: (g) => g.phase === 'won' && g.players.every((p) => p.hp === p.maxHp),
  },
  {
    id: 'full_party',
    name: 'Strength in Numbers',
    description: 'Full party survives to the final room.',
    check: (g) =>
      g.level === LEVELS.length - 1 &&
      g.players.length > 1 &&
      g.players.every((p) => p.hp > 0),
  },
  {
    id: 'daily_3',
    name: 'Time Keeper',
    description: 'Complete 3 daily challenges.',
    check: () => false, // Tracked via counter, not single-state check
  },
];

function loadAchievements(): Record<
  string,
  { unlocked: boolean; date?: string }
> {
  try {
    return JSON.parse(localStorage.getItem('chrono-achievements') ?? '{}');
  } catch {
    return {};
  }
}

function saveAchievement(id: string) {
  const data = loadAchievements();
  if (data[id]?.unlocked) return false;
  data[id] = { unlocked: true, date: new Date().toISOString().slice(0, 10) };
  try {
    localStorage.setItem('chrono-achievements', JSON.stringify(data));
  } catch {
    /* Storage unavailable in private browsing */
  }
  return true;
}

function checkAchievements(g: GameState) {
  for (const a of ACHIEVEMENTS) {
    if (a.id === 'daily_3') continue; // handled separately
    if (a.check(g) && saveAchievement(a.id)) {
      toast(`🏆 Achievement unlocked: ${a.name}`);
    }
  }
}

function incrementDailyCount() {
  try {
    const count = Number(localStorage.getItem('chrono-daily-count') ?? '0') + 1;
    localStorage.setItem('chrono-daily-count', String(count));
    if (count >= 3) {
      if (saveAchievement('daily_3')) {
        toast('🏆 Achievement unlocked: Time Keeper');
      }
    }
  } catch {
    /* Storage unavailable */
  }
}

function showAchievements() {
  const data = loadAchievements();
  const body = ACHIEVEMENTS.map((a) => {
    const state = data[a.id];
    return `<div class="achievement ${state?.unlocked ? 'unlocked' : ''}">
      <span class="achievement-icon">${state?.unlocked ? '🏆' : '🔒'}</span>
      <div>
        <strong>${escape(a.name)}</strong>
        <p>${escape(a.description)}</p>
        ${state?.unlocked ? `<small>Unlocked ${state.date ?? ''}</small>` : ''}
      </div>
    </div>`;
  }).join('');
  showModal(
    'Achievements',
    `<div class="achievements-list">${body}</div><button id="ach-done" class="button primary">Close</button>`,
    'YOUR LEGACY',
  );
  $('#ach-done').onclick = () => modal.close();
}

function loadBoard(): Promise<Board> {
  if (boardInstance) return Promise.resolve(boardInstance);
  if (!boardLoading) {
    boardLoading = import('./board').then(({ createBoard }) => {
      boardInstance = createBoard($('#phaser-board'));
      return boardInstance;
    });
  }
  return boardLoading;
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const hourglass = icon('boost');
const net = new Network();
const EMOTES = ['Ready!', 'Watch out!', 'Nice one!', 'Need backup!'] as const;
let game: GameState;
let prevState: GameState | null = null;
let room: RoomView | null = null;
let selected: number | null = null;
let targets: Position[] = [];
let handTargetCache: { state: GameState; targets: Position[][] } | null = null;
function handTargets(): Position[][] {
  // UI-only previews. State is immutable between actions, so selection/focus renders can reuse them.
  if (handTargetCache?.state !== game)
    handTargetCache = {
      state: game,
      targets: activePlayer(game).hand.map((_, index) =>
        legalTargets(game, index),
      ),
    };
  return handTargetCache.targets;
}
let busy = false;
let sound = false;
let connection = 'Local expedition';
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
try {
  const saved = JSON.parse(
    localStorage.getItem('chrono-local-v1') ?? 'null',
  ) as GameState | null;
  game =
    saved &&
    (saved.mode === 'solo' || saved.mode === 'duo') &&
    saved.players?.length &&
    saved.level >= 0 &&
    saved.level < LEVELS.length &&
    Number.isInteger(saved.rng)
      ? saved
      : createGame('solo', [{ id: 'local-1', name: 'You' }], seed());
} catch {
  game = createGame('solo', [{ id: 'local-1', name: 'You' }], seed());
}

const COSMETICS = [
  {
    id: 'default',
    name: 'Explorer',
    tint: 0xffffff,
    req: 0,
    desc: 'Classic field gear',
  },
  {
    id: 'void',
    name: 'Void Voyager',
    tint: 0xcc99ff,
    req: 1,
    desc: 'Tuned to spatial anomalies',
  },
  {
    id: 'solar',
    name: 'Solar Warden',
    tint: 0xffd275,
    req: 2,
    desc: 'Forged in stellar heat',
  },
  {
    id: 'chrono',
    name: 'Chrono Phantom',
    tint: 0x78e6ff,
    req: 3,
    desc: 'Phase-shifted across timelines',
  },
];

function getSelectedCosmetic(): string {
  try {
    return localStorage.getItem('chrono-skin') ?? 'default';
  } catch {
    return 'default';
  }
}

function showCosmeticsModal() {
  const current = getSelectedCosmetic();
  const dailyWins = Number(localStorage.getItem('chrono-daily-count') ?? '0');
  const body = `
    <p>Unlock alternate explorer tints by completing daily challenges.</p>
    <div class="skins-grid">
      ${COSMETICS.map((skin) => {
        const unlocked = dailyWins >= skin.req;
        const active = current === skin.id;
        return `
          <div class="skin-card ${active ? 'active' : ''} ${unlocked ? 'unlocked' : 'locked'}">
            <div class="skin-preview">
              ${icon('explorer')}
            </div>
            <strong>${escape(skin.name)}</strong>
            <p>${escape(skin.desc)}</p>
            <small>${skin.req === 0 ? 'Default' : `${skin.req} Daily Challenge${skin.req > 1 ? 's' : ''}`}</small>
            <button class="button small ${active ? 'subtle' : 'primary'} select-skin-btn" data-skin="${skin.id}" ${!unlocked || active ? 'disabled' : ''}>
              ${active ? 'Equipped' : unlocked ? 'Equip' : 'Locked 🔒'}
            </button>
          </div>
        `;
      }).join('')}
    </div>
    <div class="dialog-actions">
      <button id="close-skins-modal" class="button subtle">Close</button>
    </div>
  `;
  showModal('Explorer Wardrobe', body, 'COSMETICS');
  $('#close-skins-modal').onclick = () => modal.close();
  document
    .querySelectorAll<HTMLButtonElement>('.select-skin-btn')
    .forEach((btn) => {
      btn.onclick = () => {
        const skinId = btn.dataset.skin;
        if (skinId) {
          localStorage.setItem('chrono-skin', skinId);
          toast(`Equipped ${COSMETICS.find((s) => s.id === skinId)?.name}!`);
          modal.close();
          render();
        }
      };
    });
}

interface SavedGhost {
  id: string;
  name: string;
  seed: number;
  actions: GameAction[];
  turns: number;
  won: boolean;
  date: string;
}

let recordedActions: GameAction[] = [];
let isGhostMode = false;
let ghostReplayActions: GameAction[] = [];
let ghostActionIndex = 0;
let ghostPlaying = false;

function loadGhosts(): SavedGhost[] {
  try {
    return JSON.parse(localStorage.getItem('chrono-ghosts-v1') ?? '[]');
  } catch {
    return [];
  }
}

function saveGhostAlly(
  name: string,
  seed: number,
  actions: GameAction[],
  turns: number,
  won: boolean,
) {
  const ghosts = loadGhosts();
  const ghost: SavedGhost = {
    id: `ghost-${Date.now()}`,
    name,
    seed,
    actions,
    turns,
    won,
    date: new Date().toISOString().slice(0, 10),
  };
  ghosts.unshift(ghost);
  try {
    localStorage.setItem(
      'chrono-ghosts-v1',
      JSON.stringify(ghosts.slice(0, 15)),
    );
  } catch {
    /* Storage unavailable in private browsing */
  }
  void fetch(`${API_URL}/api/ghosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: ghost.id,
      seed: ghost.seed,
      mode: 'solo',
      actionsJson: JSON.stringify(ghost.actions),
      name: ghost.name,
      date: ghost.date,
    }),
  }).catch(() => {});
}

function showGhostModal() {
  const ghosts = loadGhosts();
  const defaultSample: SavedGhost = {
    id: 'sample-ada',
    name: "Ada's Echo",
    seed: 42,
    actions: [{ type: 'play', card: 0 }, { type: 'end' }],
    turns: 12,
    won: true,
    date: 'Sample',
  };
  const list = ghosts.length ? ghosts : [defaultSample];
  const body = `
    <p>Summon a recorded solo run as your co-op partner. The ghost replays its moves turn-by-turn while you play live!</p>
    <div class="ghosts-list">
      ${list
        .map(
          (g, i) => `
        <div class="ghost-item">
          <div class="ghost-info">
            <strong>${escape(g.name)}</strong>
            <span>${g.won ? 'Escaped' : 'Fell'} in ${g.turns} turns · ${escape(g.date)}</span>
          </div>
          <button class="button small primary play-ghost-btn" data-index="${i}">Summon 👻</button>
        </div>
      `,
        )
        .join('')}
    </div>
    <div class="dialog-actions">
      <button id="close-ghost-modal" class="button subtle">Close</button>
    </div>
  `;
  showModal('Ghost Ally Expedition', body, 'COGNITIVE ECHO');
  $('#close-ghost-modal').onclick = () => modal.close();
  document
    .querySelectorAll<HTMLButtonElement>('.play-ghost-btn')
    .forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        const chosen = list[idx];
        if (!chosen) return;
        modal.close();
        void startGhostRun(chosen);
      };
    });
}

async function startGhostRun(ghost: SavedGhost) {
  if (!(await confirmLeave())) return;
  try {
    await net.leave();
  } catch {
    net.clear();
    net.socket.disconnect();
  }
  room = null;
  connection = 'Ghost ally co-op';
  isGhostMode = true;
  ghostReplayActions = [...ghost.actions];
  ghostActionIndex = 0;
  game = createGame(
    'duo',
    [
      { id: 'local-1', name: 'You' },
      { id: 'ghost-1', name: `${ghost.name} (Ghost)` },
    ],
    ghost.seed,
  );
  selected = null;
  targets = [];
  saveLocal();
  render();
}

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Chrono Card home"><span class="brand-mark">${hourglass}</span><span>CHRONO<span class="brand-second">CARD<span class="brand-dot">.</span></span></span></a>
    <nav class="mode-nav" aria-label="Game modes">
      <button class="nav-item" data-mode="solo" aria-label="Solo adventure"><span class="nav-symbol">${icon('explorer')}</span><span>Solo</span></button>
      <button class="nav-item" data-mode="duo" aria-label="Couch co-op"><span class="nav-symbol">${icon('duo')}</span><span>Co-op</span></button>
      <button class="nav-item" data-mode="ghost" aria-label="Ghost ally"><span class="nav-symbol">${icon('swap')}</span><span>Ghost</span></button>
      <button class="nav-item" data-mode="online" aria-label="Play with friends"><span class="nav-symbol">${icon('shield')}</span><span>Online</span></button>
      <button class="nav-item" data-mode="daily" aria-label="Daily challenge"><span class="nav-symbol">${icon('boost')}</span><span>Daily</span><span class="tiny-dot"></span></button>
    </nav>
    <div class="sidebar-right">
      <span id="connection" class="connection">Local expedition</span>
      <button id="new-run" class="button subtle small new-run-btn" title="Start a fresh run">↻ <span>New run</span></button>
      <button id="profile-button" class="button subtle small profile-badge-btn" title="Player Profile & Account" aria-label="Player Profile"><span class="profile-icon">👤</span><span id="profile-name">Login</span></button>
      <div class="sidebar-bottom">
        <button id="achievements-button" class="tool-btn" title="Achievements" aria-label="Achievements">🏆</button>
        <button id="cosmetics-button" class="tool-btn" title="Explorer skins" aria-label="Explorer skins">🎨</button>
        <button id="help-button" class="tool-btn" title="How to play (?)" aria-label="How to play"><kbd>?</kbd></button>
        <button id="sound-button" class="tool-btn" aria-pressed="false" title="Sound: Off (Click to toggle)" aria-label="Toggle sound">🔇</button>
      </div>
    </div>
  </aside>
  <main>
    <div class="topbar-shim" style="display:none;"><strong id="mode-label">SOLO ADVENTURE</strong><button id="mobile-help">?</button></div>
    <div class="workspace">
      <section class="room-heading"><div><div class="eyebrow" id="chapter-label">CHAPTER 01 / 06</div><h1 id="room-name">The Threshold</h1><p id="room-subtitle">Every escape begins with a single step.</p></div><div class="room-progress" id="room-progress" aria-label="Dungeon progress"></div></section>
      <div class="play-layout">
        <section class="dungeon-panel" aria-label="Dungeon board"><div class="board-toolbar"><span><i class="live-dot"></i><strong id="turn-label">YOUR TURN</strong></span><span id="round-label">ROUND 01</span></div><div class="board-wrap"><div id="phaser-board"></div><div id="accessible-grid" class="accessible-grid" role="group" aria-label="Dungeon tiles. Select a card, then a tile. Arrow keys move focus; Enter selects."></div><div id="outcome" class="outcome" hidden></div></div><div class="board-legend"><span><i class="legend-player"></i> Explorer</span><span><i class="legend-danger"></i> Next attack</span><span><i class="legend-exit"></i> Exit</span><span class="legend-hint">PLAN. PLAY. REPEAT.</span></div></section>
        <aside class="run-panel"><section class="party-section"><div class="section-heading"><h2>YOUR PARTY</h2><span id="party-count">01</span></div><div id="party"></div></section><section class="enemy-section"><div class="section-heading"><h2>IN THE SHADOWS</h2><span id="enemy-count">02</span></div><div id="enemies"></div></section><section class="log-section"><div class="section-heading"><h2>FIELD NOTES</h2><span>↙</span></div><ol id="field-notes"></ol></section><div class="exit-note" id="exit-note"><span>▥</span><p>Clear the room.<br><strong>Find your way out.</strong></p></div><div class="emote-bar" id="emote-bar" hidden>${EMOTES.map((e) => `<button class="emote-btn" data-emote="${escape(e)}">${escape(e)}</button>`).join('')}</div></aside>
      </div>
      <section class="hand-section" aria-label="Your cards"><div class="hand-heading"><div><h2 id="hand-title">Your next move<span id="plays-badge">2 plays left</span></h2><p id="selection-hint" role="status" aria-live="polite" aria-atomic="true">Choose a card, then a highlighted tile.</p></div><button id="end-turn" class="button primary">End turn <span>↗</span></button></div><button id="progression-resume" class="button primary" hidden>Continue expedition</button><div id="hand" class="hand"></div></section>
      <footer class="game-footer"><span>THE DUNGEON MOVES ONLY WHEN YOU DO.</span><span><kbd>1</kbd>–<kbd>5</kbd> select card <span class="footer-separator">/</span> <kbd>Esc</kbd> cancel <span class="footer-separator">/</span> <kbd>E</kbd> end turn</span></footer>
    </div>
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <div id="drag-ghost" class="drag-ghost" style="display:none;"></div>
  <dialog id="modal" aria-labelledby="modal-title"><div id="modal-content"></div></dialog>
`;

const liveRegion = document.createElement('div');
liveRegion.setAttribute('aria-live', 'polite');
liveRegion.setAttribute('role', 'log');
liveRegion.style.cssText =
  'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap';
document.body.appendChild(liveRegion);

document
  .querySelectorAll<HTMLButtonElement>('#emote-bar .emote-btn')
  .forEach((btn) => {
    btn.onclick = () => {
      const emote = btn.dataset.emote;
      if (emote) net.sendEmote(emote);
    };
  });

function announce(prev: GameState | null, next: GameState) {
  if (prev && prev.revision === next.revision) return;
  const messages: string[] = [];
  const ap = activePlayer(next);

  if (!prev) {
    messages.push(`Entered ${LEVELS[next.level].name}. ${ap.name}'s turn.`);
  } else {
    // Level change
    if (prev.level !== next.level) {
      messages.push(`Entered ${LEVELS[next.level].name}.`);
    }
    // Card played (check log for the latest played card message)
    const newLogs = next.log.filter((l) => !prev.log.includes(l));
    for (const log of newLogs) messages.push(log);

    // Turn change
    if (prev.active !== next.active && next.phase === 'playing') {
      messages.push(`${ap.name}'s turn. Round ${next.round}.`);
    }
    // Round change
    if (prev.round !== next.round && prev.active === next.active) {
      messages.push(`Round ${next.round}.`);
    }
    // Win/loss
    if (next.phase === 'won' && prev.phase !== 'won') {
      messages.push(`Victory! Escaped in ${next.turns} turns.`);
    }
    if (next.phase === 'lost' && prev.phase !== 'lost') {
      messages.push('Defeat. The expedition has ended.');
    }
    // Room cleared
    if (
      prev.enemies.length > 0 &&
      next.enemies.length === 0 &&
      next.phase === 'playing'
    ) {
      messages.push('All enemies defeated. The exit is open.');
    }
  }

  if (messages.length) {
    liveRegion.textContent = messages.join(' ');
  }
}

const modal = $<HTMLDialogElement>('#modal');
let toastTimer: number;
function toast(message: string) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 5000);
}
function beep(
  type: 'move' | 'attack' | 'support' | 'end' | 'default' = 'default',
) {
  if (!sound) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  const configs: Record<
    typeof type,
    {
      wave: OscillatorType;
      startFreq: number;
      endFreq: number;
      gainVal: number;
      duration: number;
    }
  > = {
    move: {
      wave: 'sine',
      startFreq: 280,
      endFreq: 180,
      gainVal: 0.05,
      duration: 0.08,
    },
    attack: {
      wave: 'sawtooth',
      startFreq: 580,
      endFreq: 120,
      gainVal: 0.08,
      duration: 0.13,
    },
    support: {
      wave: 'triangle',
      startFreq: 440,
      endFreq: 880,
      gainVal: 0.07,
      duration: 0.18,
    },
    end: {
      wave: 'triangle',
      startFreq: 330,
      endFreq: 220,
      gainVal: 0.06,
      duration: 0.12,
    },
    default: {
      wave: 'square',
      startFreq: 420,
      endFreq: 220,
      gainVal: 0.07,
      duration: 0.15,
    },
  };

  const c = configs[type] ?? configs.default;
  oscillator.type = c.wave;
  oscillator.frequency.setValueAtTime(c.startFreq, audio.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    c.endFreq,
    audio.currentTime + c.duration * 0.8,
  );
  gain.gain.setValueAtTime(c.gainVal, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + c.duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + c.duration + 0.01);
  oscillator.onended = () => {
    void audio.close();
  };
}
function canPlay() {
  return (
    !busy &&
    game.phase === 'playing' &&
    (!isGhostMode || activePlayer(game).id !== 'ghost-1') &&
    (!room ||
      (net.socket.connected &&
        !room.paused &&
        activePlayer(game).id === net.session?.playerId))
  );
}
function saveLocal() {
  if (!room)
    try {
      localStorage.setItem('chrono-local-v1', JSON.stringify(game));
    } catch {
      /* Storage may be unavailable in private browsing. */
    }
}
function setSelection(index: number | null) {
  selected = index;
  targets = index === null ? [] : (handTargets()[index] ?? []);
  render();
}
async function act(action: GameAction) {
  if (
    !(action.type === 'choose-room' || action.type === 'draft-card'
      ? canDecide()
      : canPlay())
  )
    return;
  const playedCardId =
    action.type === 'play' ? activePlayer(game).hand[action.card] : null;
  const soundCategory = playedCardId
    ? (CARDS[playedCardId]?.category ?? 'default')
    : 'end';
  busy = true;
  render();
  try {
    if (room) await net.action(action, game.revision);
    else {
      if (game.mode === 'solo' && !isGhostMode) {
        recordedActions.push(action);
      }
      game = applyAction(game, activePlayer(game).id, action);
      saveLocal();
    }
    selected = null;
    targets = [];
    beep(soundCategory);
  } catch (error) {
    toast(
      error instanceof Error ? error.message : 'That move could not be played.',
    );
  } finally {
    busy = false;
    render();
  }
}

let dragState = {
  active: false,
  cardIndex: -1,
  startX: 0,
  startY: 0,
  moved: false,
};

function startCardDrag(e: PointerEvent, index: number) {
  // A phone swipe scrolls the inventory; only a completed tap selects a card.
  if (e.pointerType === 'touch' || !canPlay()) return;
  selectCard(index);
  dragState = {
    active: true,
    cardIndex: index,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
}

window.addEventListener('pointermove', (e) => {
  if (!dragState.active) return;
  if (
    !dragState.moved &&
    Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) > 8
  ) {
    dragState.moved = true;
  }
  if (dragState.moved) {
    const cardId = activePlayer(game).hand[dragState.cardIndex];
    const ghost = $('#drag-ghost');
    if (ghost && cardId) {
      const card = CARDS[cardId];
      ghost.innerHTML = `<span class="ghost-card-pill ${card.category}"><span>${icon(cardId)}</span> <strong>${card.name}</strong></span>`;
      ghost.style.display = 'block';
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY - 24}px`;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest('.grid-cell') as HTMLElement | null;
    document
      .querySelectorAll('.grid-cell.drag-hover')
      .forEach((c) => c.classList.remove('drag-hover'));
    if (cell) {
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      if (targets.some((t) => same(t, { x, y }))) {
        cell.classList.add('drag-hover');
      }
    }
  }
});

window.addEventListener('pointerup', (e) => {
  if (!dragState.active) return;
  const ghost = $('#drag-ghost');
  if (ghost) ghost.style.display = 'none';
  document
    .querySelectorAll('.grid-cell.drag-hover')
    .forEach((c) => c.classList.remove('drag-hover'));
  if (dragState.moved) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest('.grid-cell') as HTMLElement | null;
    if (cell) {
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      if (targets.some((t) => same(t, { x, y })) && canPlay()) {
        void act({ type: 'play', card: dragState.cardIndex, target: { x, y } });
      }
    }
  }
  dragState.active = false;
});

function selectCard(index: number) {
  if (!canPlay()) return;
  if (selected === index) {
    setSelection(null);
    return;
  }
  const id = activePlayer(game).hand[index];
  if (id === 'redraw' && handTargets()[index]?.length) {
    void act({ type: 'play', card: index });
    return;
  }
  setSelection(index);
  if (
    window.innerWidth <= 700 &&
    $('.board-wrap').getBoundingClientRect().top < 0
  )
    $('.board-wrap').scrollIntoView({ block: 'center', behavior: 'instant' });
}
function tileLabel(x: number, y: number) {
  const position = { x, y };
  const tile = tileAt(game, position);
  const player = game.players.find((p) => p.hp > 0 && same(p, position));
  const enemy = game.enemies.find((e) => same(e, position));
  const pendingHazard = game.enemies.some((e) =>
    e.intent.hazard?.some((p) => same(p, position)),
  );
  const temporary = (game.hazards ?? []).find((h) => same(h, position));
  const attacks = game.enemies.filter((e) =>
    e.intent.attack.some((p) => same(p, position)),
  );
  return `Column ${x + 1}, row ${y + 1}: ${player ? `${player.name}, ${player.hp} HP` : enemy ? `${ENEMIES[enemy.kind].name}, ${enemy.hp} HP${enemy.intent.charging ? ', charging, attacks in two rounds' : ''}` : tile === '#' ? 'wall' : tile === '~' ? 'hazard, 1 damage on entry' : tile === 'E' ? `exit ${game.enemies.length ? 'locked' : 'open'}` : 'floor'}${temporary ? `, embers: ${temporary.expiresRound - game.round} rounds left, 1 damage on entry` : ''}${pendingHazard ? ', Bomber will drop embers here next round' : ''}${attacks.length ? (attacks.every((e) => e.intent.charging) ? ', charging attack here in two rounds' : ', enemy will attack here next round') : ''}${targets.some((p) => same(p, position)) ? ', valid target' : ''}`;
}
const grid = $('#accessible-grid');
let currentGridLevel = -1;

function updateAccessibleGrid(levelIndex: number) {
  if (currentGridLevel === levelIndex) return;
  currentGridLevel = levelIndex;
  const level = LEVELS[levelIndex];
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${level.width}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${level.height}, 1fr)`;
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const cell = document.createElement('button');
      cell.className = 'grid-cell';
      cell.dataset.x = `${x}`;
      cell.dataset.y = `${y}`;
      cell.tabIndex = x === 1 && y === 1 ? 0 : -1;
      cell.addEventListener('click', () => {
        if (selected !== null && canPlay())
          void act({ type: 'play', card: selected, target: { x, y } });
        else toast(tileLabel(x, y));
      });
      grid.append(cell);
    }
  }
}

grid.addEventListener('keydown', (event) => {
  const level = LEVELS[game.level];
  const deltas: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -level.width,
    ArrowDown: level.width,
  };
  if (!(event.key in deltas)) return;
  event.preventDefault();
  const cells = [...grid.children] as HTMLButtonElement[];
  const current = cells.indexOf(document.activeElement as HTMLButtonElement);
  const next = Math.max(
    0,
    Math.min(cells.length - 1, current + deltas[event.key]),
  );
  if (cells[current]) cells[current].tabIndex = -1;
  if (cells[next]) {
    cells[next].tabIndex = 0;
    cells[next].focus();
  }
});
function render() {
  updateAccessibleGrid(game.level);
  const p = activePlayer(game);
  const previews = handTargets();
  targets = selected === null ? [] : (previews[selected] ?? []);
  const focusedCard =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLButtonElement>('[data-card]')
          ?.dataset.card
      : undefined;
  const level = LEVELS[game.level];
  const playable = canPlay();
  $('.board-wrap').style.aspectRatio = `${level.width} / ${level.height}`;
  const modeText = room
    ? room.mode === 'daily'
      ? 'DAILY CHALLENGE'
      : `ONLINE ${room.mode === 'duo' ? 'DUO' : 'PARTY'} · ${room.code}`
    : isGhostMode
      ? 'GHOST ALLY CO-OP'
      : game.mode === 'duo'
        ? 'COUCH CO-OP'
        : 'SOLO ADVENTURE';
  $('#mode-label').textContent = modeText;
  $('#connection').textContent = room
    ? room.code
      ? `${room.mode.toUpperCase()} · ${room.code}`
      : connection
    : isGhostMode
      ? 'Ghost ally run'
      : 'Local expedition';
  $('#chapter-label').textContent =
    `CHAPTER ${String(game.level + 1).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`;
  $('#room-name').textContent = level.name;
  $('#room-subtitle').textContent = level.subtitle;
  const acts = ACTS.map((act) => ({
    name: act.name.split(' — ')[0],
    start: LEVELS.findIndex((level) => level.id === act.entry),
    end: LEVELS.findIndex(
      (level) => level.id === act.rooms[act.rooms.length - 1].id,
    ),
  }));
  $('#room-progress').innerHTML = acts
    .map((act) => {
      const steps = LEVELS.slice(act.start, act.end + 1)
        .map((l, idx) => {
          const i = act.start + idx;
          const isBoss = l.next.length === 0 && i < LEVELS.length - 1;
          const isFinalBoss = i === LEVELS.length - 1;
          const bossIcon = isFinalBoss ? '👑' : isBoss ? '⚔' : '';
          const label =
            game.visitedRooms?.includes(l.id) && i !== game.level
              ? '✓'
              : bossIcon || String(i + 1).padStart(2, '0');
          const classes = [
            'progress-step',
            i === game.level
              ? 'current'
              : game.visitedRooms?.includes(l.id)
                ? 'complete'
                : '',
            bossIcon ? 'boss-step' : '',
            isFinalBoss ? 'final-boss-step' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `<span class="${classes}" title="${escape(l.name)}${bossIcon ? ' (Boss)' : ''}">${label}</span>`;
        })
        .join('');
      return `<div class="act-track"><span class="act-tag">${act.name}</span><div class="act-steps">${steps}</div></div>`;
    })
    .join('<span class="act-separator">▸</span>');
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => {
    const current =
      el.dataset.mode ===
      (room
        ? room.mode === 'daily'
          ? 'daily'
          : 'online'
        : isGhostMode
          ? 'ghost'
          : game.mode);
    el.classList.toggle('active', current);
    el.setAttribute('aria-current', current ? 'page' : 'false');
  });
  $('#turn-label').textContent =
    room && !room.game
      ? 'PARTY IS GATHERING'
      : game.phase === 'choosing'
        ? 'CHOOSE YOUR PATH'
        : game.phase === 'drafting'
          ? 'CHOOSE A NEW CARD'
          : game.phase !== 'playing'
            ? 'EXPEDITION COMPLETE'
            : room?.paused
              ? 'WAITING FOR RECONNECT'
              : room && !net.session
                ? 'SPECTATING'
                : playable
                  ? game.players.length === 1 || (!room && p.name === 'You')
                    ? 'YOUR TURN'
                    : `${p.name.toUpperCase()}'S TURN`
                  : `${p.name.toUpperCase()}'S TURN`;
  $('#round-label').textContent =
    `ROUND ${String(game.round).padStart(2, '0')}`;
  $('#party-count').textContent = `${game.players.length}`.padStart(2, '0');
  $('#party').innerHTML = game.players
    .map(
      (player, i) =>
        `<div class="party-member ${player.id === p.id ? 'current-player' : ''}"><div class="portrait player-${i}">${icon('explorer')}<span>${i + 1}</span></div><div class="party-details"><div><strong>${escape(player.name)}</strong><small>${player.hp <= 0 ? (player.abandoned ? 'LEFT' : 'FALLEN') : player.id === p.id ? 'ACTIVE' : 'READY'}</small></div><div class="hearts" aria-hidden="true">${Array.from({ length: 6 }, (_, heart) => `<span class="${player.hp > heart * 2 ? '' : 'empty-heart'}">${icon('heart')}</span>`).join('')}</div><div class="hp-label"><span>HP ${player.hp} <span>/ ${player.maxHp}</span></span><span>${player.shield ? '◇ Shielded' : 'Explorer'}</span></div></div></div>`,
    )
    .join('');
  $('#enemy-count').textContent = `${game.enemies.length}`.padStart(2, '0');
  $('#enemies').innerHTML = game.enemies.length
    ? Object.entries(ENEMIES)
        .filter(([kind]) => game.enemies.some((e) => e.kind === kind))
        .map(
          ([kind, definition]) =>
            `<div class="enemy-entry"><span class="enemy-icon ${kind}">${icon(kind)}</span><div><strong>${definition.name}<span>×${game.enemies.filter((e) => e.kind === kind).length}</span></strong><p>${escape(definition.description)}</p></div></div>`,
        )
        .join('')
    : '<p class="empty-enemies">All clear.<br>The exit is open. ↗</p>';
  $('#field-notes').innerHTML = game.log
    .slice(-4)
    .map(
      (line, i, all) =>
        `<li class="${i === all.length - 1 ? 'latest' : ''}">${escape(line)}</li>`,
    )
    .join('');
  $('#exit-note').innerHTML = room
    ? `<span>⌘</span><p>Room <strong>${room.code}</strong><br><button class="text-button" id="share-watch">Copy spectator link ↗</button></p>`
    : `<span>▥</span><p>${game.enemies.length ? 'Clear the room.' : 'The path is open.'}<br><strong>${game.enemies.length ? 'Find your way out.' : 'Reach the glowing exit.'}</strong></p>`;
  $('#share-watch')?.addEventListener('click', () => void copyLink(true));
  $('#hand-title').innerHTML =
    `${room && !playable ? `${escape(p.name)}’s hand` : game.players.length > 1 ? `${escape(p.name)}’s turn` : 'COMMAND DECK'}<span id="plays-badge">${game.plays} ${game.plays === 1 ? 'play' : 'plays'} left</span>`;
  const selectedCard = selected === null ? null : CARDS[p.hand[selected]];
  $('#selection-hint').textContent =
    room && !room.game
      ? 'Your room is open. Choose Play with friends to return to the lobby.'
      : room?.paused
        ? `Holding your teammate’s slot for ${room.graceSeconds} seconds.`
        : selectedCard
          ? `${selectedCard.name}: ${targets.length ? selectedCard.description : 'No valid targets for this card right now. Keep it selected to inspect the board, choose another card, or use Second chance.'}`
          : !playable && room
            ? net.session
              ? 'Watch your teammate plan their move.'
              : 'You’re watching this expedition. Share the link to invite more spectators.'
            : game.plays === 0
              ? 'Your moves are made. End your turn when ready.'
              : 'Choose a card, then a highlighted tile.';
  $<HTMLButtonElement>('#end-turn').disabled = !playable;
  $('#hand').innerHTML = p.hand
    .map((id, index) => {
      const card = CARDS[id];
      const useful = previews[index].length > 0;
      const cooldown = Math.max(0, (p.cooldowns?.[id] ?? 0) - game.round);
      const status = useful
        ? `${previews[index].length} valid targets`
        : `No valid targets right now${cooldown ? ` • Recharging: ${cooldown} rounds` : ''}`;
      return `<button class="card ${card.category} ${useful ? '' : 'not-useful'} ${selected === index ? 'selected' : ''}" data-card="${index}" aria-label="${escape(card.name)}" aria-describedby="card-description-${index} card-status-${index}" aria-pressed="${selected === index}" ${!playable ? 'disabled' : ''}><span class="card-top"><span>${card.category.toUpperCase()}</span><kbd>${index + 1}</kbd></span><span class="card-art" aria-hidden="true"><span class="art-orbit"></span><span>${icon(id)}</span><i>✦</i></span><strong>${card.name}</strong><span class="card-description"><span id="card-description-${index}">${card.description}</span><span class="card-status" id="card-status-${index}">${status}</span></span><span class="card-bottom">${id === 'redraw' || card.cost === 0 ? 'FREE PLAY' : '1 PLAY'}<span>${card.category === 'move' ? '↗' : card.category === 'attack' ? '✧' : '◇'}</span></span></button>`;
    })
    .join('');
  document
    .querySelectorAll<HTMLButtonElement>('[data-card]')
    .forEach((button) => {
      button.addEventListener('click', () =>
        selectCard(Number(button.dataset.card)),
      );
      button.addEventListener('pointerdown', (e) =>
        startCardDrag(e, Number(button.dataset.card)),
      );
    });
  if (focusedCard !== undefined)
    document
      .querySelector<HTMLButtonElement>(`[data-card="${focusedCard}"]`)
      ?.focus({ preventScroll: true });
  grid.setAttribute('aria-describedby', 'selection-hint');
  const noTargets = selected !== null && !targets.length;
  grid.setAttribute(
    'aria-label',
    `Dungeon tiles. Arrow keys move focus; Enter selects.${noTargets ? ` No valid targets for ${selectedCard?.name ?? 'this card'} right now.` : ' Select a card, then a highlighted tile.'}`,
  );
  for (const cell of grid.children as HTMLCollectionOf<HTMLButtonElement>) {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    cell.setAttribute(
      'aria-label',
      `${tileLabel(x, y)}${noTargets ? ', no valid targets for the selected card' : ''}`,
    );
    cell.classList.toggle(
      'target',
      targets.some((t) => same(t, { x, y })),
    );
  }
  const inLobby =
    Boolean(room && !room.game) ||
    (!room &&
      (new URLSearchParams(location.search).has('room') ||
        new URLSearchParams(location.search).has('watch')));
  $('#emote-bar').hidden = !room;
  if (boardInstance) {
    boardInstance.update(game, targets);
  } else if (!inLobby) {
    void loadBoard().then((b) => b.update(game, targets));
  }
  $('#outcome').hidden = game.phase !== 'won' && game.phase !== 'lost';
  if (game.phase === 'won' || game.phase === 'lost') {
    const canSaveGhost =
      !isGhostMode && game.mode === 'solo' && recordedActions.length > 0;
    $('#outcome').innerHTML =
      `<div class="outcome-card"><span>${game.phase === 'won' ? '✧' : '⌛'}</span><div class="eyebrow">${game.phase === 'won' ? 'THE CYCLE IS BROKEN' : 'EVERY END IS A BEGINNING'}</div><h2>${game.phase === 'won' ? 'Time is yours.' : 'Out of time.'}</h2><p>${game.phase === 'won' ? `${game.visitedRooms?.length ?? game.level + 1} rooms visited. ${game.turns} turns. One well-earned escape.` : `You reached room ${game.level + 1}. A new hand awaits.`}</p><button id="play-again" class="button primary">Another expedition ↗</button>${canSaveGhost ? `<div class="ghost-save-box"><p>Save this run as a Ghost ally?</p><div class="ghost-save-row"><input id="ghost-name-input" maxlength="20" placeholder="Ghost name" value="Past Explorer" /><button id="save-ghost-btn" class="button subtle small">Save Ghost 👻</button></div></div>` : ''}${room?.mode === 'daily' && game.phase === 'won' ? '<p>Your score is on today’s leaderboard.</p>' : ''}</div>`;
    $('#play-again').addEventListener('click', () => void newLocal('solo'));
    $('#save-ghost-btn')?.addEventListener('click', () => {
      const nameInput = $('#ghost-name-input') as HTMLInputElement;
      const ghostName = nameInput?.value.trim() || 'Explorer Ghost';
      saveGhostAlly(
        ghostName,
        game.seed,
        [...recordedActions],
        game.turns,
        game.phase === 'won',
      );
      toast(
        `Ghost "${ghostName}" saved! Choose "Ghost ally" in the sidebar to play alongside it.`,
      );
      const box = $('.ghost-save-box');
      if (box)
        box.innerHTML = `<p class="ghost-saved-msg">✓ Saved as "${escape(ghostName)}". Ready to summon in Ghost mode!</p>`;
    });
  }

  if (
    isGhostMode &&
    (game.phase === 'playing' ||
      game.phase === 'choosing' ||
      game.phase === 'drafting') &&
    activePlayer(game).id === 'ghost-1' &&
    !ghostPlaying
  ) {
    ghostPlaying = true;
    window.setTimeout(() => {
      if (
        !isGhostMode ||
        (game.phase !== 'playing' &&
          game.phase !== 'choosing' &&
          game.phase !== 'drafting') ||
        activePlayer(game).id !== 'ghost-1'
      ) {
        ghostPlaying = false;
        return;
      }
      let action = ghostReplayActions[ghostActionIndex++];
      if (game.phase === 'choosing')
        action = { type: 'choose-room', roomId: game.roomChoices[0] };
      if (game.phase === 'drafting')
        action = {
          type: 'draft-card',
          cardId: game.draftChoices['ghost-1'][0],
        };
      if (!action) action = { type: 'end' };
      try {
        game = applyAction(game, 'ghost-1', action);
        beep('support');
      } catch {
        try {
          game = applyAction(game, 'ghost-1', { type: 'end' });
        } catch {
          /* Turn end fallback */
        }
      } finally {
        ghostPlaying = false;
        render();
      }
    }, 350);
  }

  renderProgression();
  if (game) {
    checkAchievements(game);
  }
  if (
    prevState &&
    prevState.phase !== 'won' &&
    prevState.phase !== 'lost' &&
    (game.phase === 'won' || game.phase === 'lost')
  ) {
    void auth.recordRun({
      won: game.phase === 'won',
      turns: game.turns,
      daily: room?.mode === 'daily',
    });
  }
  announce(prevState, game);
  prevState = game;
}
function updateProfileBadge() {
  const user = auth.getUser();
  const nameEl = $('#profile-name');
  if (nameEl) {
    nameEl.textContent = user ? user.username : 'Login';
  }
}
function showProfileModal() {
  const user = auth.getUser();
  if (user) {
    renderLoggedInProfile(user);
  } else {
    renderAuthModal('login');
  }
}
function canDecide() {
  return (
    !busy &&
    (game.phase === 'choosing' || game.phase === 'drafting') &&
    (!isGhostMode || activePlayer(game).id !== 'ghost-1') &&
    (!room ||
      (net.socket.connected &&
        !room.paused &&
        activePlayer(game).id === net.session?.playerId))
  );
}
let progressionModal = '';
function renderProgression() {
  const resume = $<HTMLButtonElement>('#progression-resume');
  resume.hidden = game.phase !== 'choosing' && game.phase !== 'drafting';
  resume.textContent =
    game.phase === 'drafting'
      ? 'Choose your reward ↗'
      : 'Choose your next path ↗';
  resume.onclick = () => {
    progressionModal = '';
    renderProgression();
  };
  if (game.phase !== 'choosing' && game.phase !== 'drafting') {
    if (progressionModal) {
      modal.close();
      progressionModal = '';
    }
    return;
  }
  const signature = `${game.seed}:${game.revision}:${canDecide()}:${connection}`;
  if (progressionModal === signature && modal.open) return;
  progressionModal = signature;
  if (game.phase === 'drafting') {
    showModal(
      'A gift from the ruins',
      `<p>${escape(activePlayer(game).name)}: choose one card to keep for this expedition. ${canDecide() ? '' : 'Waiting for their choice…'}</p><div class="progression-options draft-options">${(game.draftChoices[activePlayer(game).id] ?? []).map((id) => `<button class="progression-option" data-draft-card="${id}" ${canDecide() ? '' : 'disabled'}><span aria-hidden="true">${icon(id)}</span><strong>${escape(CARDS[id].name)}</strong><span>${escape(CARDS[id].description)}</span></button>`).join('')}</div>`,
      'DRAFT • KEEP ONE',
    );
    modal.querySelectorAll<HTMLButtonElement>('[data-draft-card]').forEach(
      (button) =>
        (button.onclick = () =>
          void act({
            type: 'draft-card',
            cardId: button.dataset.draftCard as CardId,
          })),
    );
    modal
      .querySelector<HTMLButtonElement>('.progression-option:not(:disabled)')
      ?.focus();
    return;
  }
  showModal(
    'Which path next?',
    `<p>${canDecide() ? 'Choose the party’s next room. Both paths meet again before the Act’s warden.' : `${escape(activePlayer(game).name)} is choosing the party’s path.`}</p><div class="progression-options">${game.roomChoices
      .map((id) => {
        const level = LEVELS.find((level) => level.id === id)!;
        return `<button class="progression-option" data-room-choice="${id}" ${canDecide() ? '' : 'disabled'}><strong>${escape(level.name)}</strong><span>${escape(level.choiceDescription)}</span></button>`;
      })
      .join('')}</div>`,
    'ROOM CLEARED',
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-room-choice]').forEach(
    (button) =>
      (button.onclick = () =>
        void act({
          type: 'choose-room',
          roomId: button.dataset.roomChoice!,
        })),
  );
  modal
    .querySelector<HTMLButtonElement>('.progression-option:not(:disabled)')
    ?.focus();
}

function renderLoggedInProfile(user: UserProfile) {
  const s = user.stats;
  const winRate =
    s.runsPlayed > 0 ? Math.round((s.runsWon / s.runsPlayed) * 100) : 0;
  const best = s.bestTurns < 999999 ? `${s.bestTurns} turns` : '—';
  const joinedDate = user.createdAt ? user.createdAt.slice(0, 10) : 'Active';

  const body = `
    <div class="profile-container">
      <div class="profile-header-card">
        <div class="profile-avatar-large">
          ${icon('explorer')}
        </div>
        <div class="profile-user-info">
          <h3>${escape(user.username)}</h3>
          <p class="profile-meta">Explorer · Joined ${escape(joinedDate)}</p>
          <div class="profile-badge-row">
            <span class="user-badge">${escape(user.avatar || 'Explorer')}</span>
            <span class="user-badge win-badge">${winRate}% Win Rate</span>
          </div>
        </div>
      </div>

      <div class="profile-stats-grid">
        <div class="profile-stat-box">
          <span class="stat-number">${s.runsPlayed}</span>
          <span class="stat-desc">Expeditions</span>
        </div>
        <div class="profile-stat-box">
          <span class="stat-number highlight-win">${s.runsWon}</span>
          <span class="stat-desc">Victories</span>
        </div>
        <div class="profile-stat-box">
          <span class="stat-number highlight-daily">${s.dailyWins}</span>
          <span class="stat-desc">Daily Wins</span>
        </div>
        <div class="profile-stat-box">
          <span class="stat-number">${best}</span>
          <span class="stat-desc">Best Escape</span>
        </div>
      </div>

      <div class="profile-section">
        <div class="section-title-sm">AVATAR IDENTITY</div>
        <div class="avatar-pick-grid">
          ${COSMETICS.map(
            (c) => `
            <button class="avatar-option ${user.avatar === c.name ? 'selected' : ''}" data-avatar="${escape(c.name)}">
              <span>${icon('explorer')}</span>
              <small>${escape(c.name)}</small>
            </button>
          `,
          ).join('')}
        </div>
      </div>

      <div class="dialog-actions profile-actions">
        <button id="profile-logout-btn" class="button subtle">Log out</button>
        <button id="profile-close-btn" class="button primary">Back to game</button>
      </div>
    </div>
  `;

  showModal('Explorer Dossier', body, 'PLAYER IDENTITY');
  $('#profile-close-btn').onclick = () => modal.close();
  $('#profile-logout-btn').onclick = () => {
    auth.logout();
    toast('Logged out successfully.');
    updateProfileBadge();
    modal.close();
  };
  document
    .querySelectorAll<HTMLButtonElement>('.avatar-option')
    .forEach((btn) => {
      btn.onclick = async () => {
        const av = btn.dataset.avatar;
        if (av) {
          await auth.updateAvatar(av);
          toast(`Avatar set to ${av}`);
          const updated = auth.getUser();
          if (updated) renderLoggedInProfile(updated);
        }
      };
    });
}
function renderAuthModal(activeTab: 'login' | 'register') {
  const isLogin = activeTab === 'login';
  const body = `
    <div class="auth-tabs">
      <button class="auth-tab ${isLogin ? 'active' : ''}" id="tab-login">Sign In</button>
      <button class="auth-tab ${!isLogin ? 'active' : ''}" id="tab-register">Register</button>
    </div>

    <form id="auth-form" class="auth-form">
      <label>
        Username
        <input type="text" id="auth-username" required minlength="3" maxlength="20" placeholder="e.g. ChronoKnight" autocomplete="username" />
      </label>
      <label>
        Password
        <input type="password" id="auth-password" required minlength="6" placeholder="At least 6 characters" autocomplete="${isLogin ? 'current-password' : 'new-password'}" />
      </label>
      ${
        !isLogin
          ? `
        <label>
          Starting Title
          <select id="auth-avatar">
            <option value="Explorer">Explorer</option>
            <option value="Void Voyager">Void Voyager</option>
            <option value="Solar Warden">Solar Warden</option>
            <option value="Chrono Phantom">Chrono Phantom</option>
          </select>
        </label>
      `
          : ''
      }
      <p id="form-error" class="form-error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" id="auth-guest" class="button subtle">Continue as Guest</button>
        <button type="submit" id="auth-submit" class="button primary">${isLogin ? 'Sign In ↗' : 'Create Account ↗'}</button>
      </div>
    </form>
    <p class="auth-footer-note">Accounts sync your runs, best times, and achievements across devices.</p>
  `;

  showModal(
    isLogin ? 'Sign In to Chrono Card' : 'Create Explorer Account',
    body,
    'ARCHIVES ACCESS',
  );

  $('#tab-login').onclick = () => renderAuthModal('login');
  $('#tab-register').onclick = () => renderAuthModal('register');
  $('#auth-guest').onclick = () => modal.close();

  const form = $<HTMLFormElement>('#auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const username = ($<HTMLInputElement>('#auth-username').value || '').trim();
    const password = $<HTMLInputElement>('#auth-password').value || '';
    const avatar = !isLogin
      ? $<HTMLSelectElement>('#auth-avatar')?.value || 'Explorer'
      : undefined;

    const errorEl = $('#form-error');
    if (errorEl) errorEl.textContent = '';

    await safe(async () => {
      if (isLogin) {
        await auth.login(username, password);
        toast(`Welcome back, ${username}!`);
      } else {
        await auth.register(username, password, avatar);
        toast(`Account created! Welcome, ${username}!`);
      }
      updateProfileBadge();
      const u = auth.getUser();
      if (u) {
        renderLoggedInProfile(u);
      } else {
        modal.close();
      }
    });
  };
}
function showModal(
  title: string,
  body: string,
  eyebrow = 'A LITTLE BORROWED TIME',
) {
  $('#modal-content').innerHTML =
    `<button class="modal-close" aria-label="Close dialog">×</button><div class="eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2>${body}`;
  $('.modal-close').addEventListener('click', () => modal.close());
  if (!modal.open) modal.showModal();
}
async function safe(work: () => Promise<void>) {
  const buttons = [
    ...modal.querySelectorAll<HTMLButtonElement>(
      'button[type="submit"], [data-network]',
    ),
  ];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await work();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The request timed out. Try again.';
    const errorBox = $('#form-error');
    if (errorBox) errorBox.textContent = message;
    toast(message);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
async function confirmLeave() {
  if (!room) return true;
  return await new Promise<boolean>((resolve) => {
    showModal(
      'Leave this expedition?',
      '<p>Your online slot will be released. Your teammates can continue.</p><div class="dialog-actions"><button id="cancel-leave" class="button subtle">Stay here</button><button id="confirm-leave" class="button primary">Leave expedition</button></div>',
    );
    const closed = () => {
      modal.removeEventListener('close', closed);
      resolve(false);
    };
    modal.addEventListener('close', closed);
    $('#cancel-leave').onclick = () => modal.close();
    $('#confirm-leave').onclick = () => {
      modal.removeEventListener('close', closed);
      modal.close();
      resolve(true);
    };
  });
}
async function newLocal(mode: 'solo' | 'duo') {
  if (!(await confirmLeave())) return;
  try {
    await net.leave();
  } catch {
    net.clear();
    net.socket.disconnect();
  }
  room = null;
  connection = 'Local expedition';
  isGhostMode = false;
  recordedActions = [];
  const myName = auth.getUser()?.username ?? 'You';
  game = createGame(
    mode,
    mode === 'duo'
      ? [
          { id: 'local-1', name: myName },
          { id: 'local-2', name: 'Explorer 2' },
        ]
      : [{ id: 'local-1', name: myName }],
    seed(),
  );
  selected = null;
  targets = [];
  saveLocal();
  render();
  modal.close();
}
async function copyLink(watch: boolean) {
  if (!room) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set(watch ? 'watch' : 'room', room.code);
  try {
    await navigator.clipboard.writeText(url.href);
    toast(`${watch ? 'Spectator' : 'Invite'} link copied.`);
  } catch {
    showModal(
      'Share this expedition',
      `<label>Copy this link<input value="${escape(url.href)}" readonly /></label>`,
    );
  }
}
function lobby() {
  if (!room) return;
  const host = net.session?.playerId === room.host;
  showModal(
    'Better together.',
    `<p>${room.mode === 'daily' ? 'The same dungeon and deck seed for everyone today. Finish the run to record your score.' : 'Share your code. Gather your party. Make it out together.'}</p><div class="room-code"><span>ROOM CODE</span><strong>${room.code}</strong><button id="copy-invite" class="text-button">Copy invite link ↗</button></div><div class="lobby-members">${room.members.map((m, i) => `<div><span class="member-number">0${i + 1}</span><strong>${escape(m.name)}</strong><span>${m.connected ? (m.id === room!.host ? 'HOST · READY' : 'READY') : 'RECONNECTING'}</span></div>`).join('')}${room.mode !== 'daily' && room.members.length < (room.mode === 'duo' ? 2 : 4) ? '<div class="waiting-slot">+ Waiting for another explorer…</div>' : ''}</div><p id="form-error" class="form-error" role="alert"></p><div class="dialog-actions"><button id="leave-lobby" class="button subtle">Leave room</button><button id="start-room" class="button primary" data-network ${!host || room.members.some((m) => !m.connected) || (room.mode !== 'daily' && room.members.length < 2) ? 'disabled' : ''}>${host ? 'Begin expedition ↗' : 'Waiting for host…'}</button><div class="emote-bar">${EMOTES.map((e) => `<button class="emote-btn" data-emote="${escape(e)}">${escape(e)}</button>`).join('')}</div></div><button id="spectator-link" class="text-button">Copy spectator link</button>`,
    room.mode === 'daily' ? 'DAILY CHALLENGE · UTC' : 'ONLINE EXPEDITION',
  );
  $('#copy-invite').onclick = () => void copyLink(false);
  $('#spectator-link').onclick = () => void copyLink(true);
  $('#leave-lobby').onclick = () =>
    void safe(async () => {
      await net.leave();
      room = null;
      modal.close();
      render();
    });
  $('#start-room').onclick = () =>
    void safe(async () => {
      await net.start();
    });
  document.querySelectorAll<HTMLButtonElement>('.emote-btn').forEach((btn) => {
    btn.onclick = () => {
      const emote = btn.dataset.emote;
      if (emote) net.sendEmote(emote);
    };
  });
}
function online(prefill = '', watch = false) {
  if (room) {
    if (!room.game) lobby();
    else
      showModal(
        'Your expedition',
        `<p>Room <strong>${room.code}</strong> · ${room.spectators} spectators</p><div class="dialog-actions"><button id="online-share" class="button primary">Copy spectator link</button><button id="online-leave" class="button subtle">Leave expedition</button></div>`,
      );
    if (room.game) {
      $('#online-share').onclick = () => void copyLink(true);
      $('#online-leave').onclick = () => void newLocal('solo');
    }
    return;
  }
  showModal(
    'Gather your party.',
    `<p>Two to four explorers. One dungeon. A plan worth sharing.</p><form id="online-form"><label>Your name<input id="player-name" name="name" maxlength="20" value="Explorer" required autocomplete="nickname" /></label><div class="online-columns"><section><h3>Start something.</h3><p>A private room for your next adventure.</p><label>Party size<select id="room-mode"><option value="party">2–4 explorers</option><option value="duo">Duo · 2 explorers</option></select></label><label>Turn order<select id="room-turn-order"><option value="alternating">Alternating turns (classic)</option><option value="simultaneous">Simultaneous turns (fast)</option></select></label><button class="button primary" type="submit" name="intent" value="create">Create a room ↗</button></section><section><h3>Find your people.</h3><label>Room code<input id="room-code-input" name="code" maxlength="6" placeholder="ABC234" value="${escape(prefill)}" autocomplete="off" autocapitalize="characters" /></label><button class="button subtle" type="submit" name="intent" value="join">Join expedition ↗</button><button class="text-button" type="submit" name="intent" value="watch">${watch ? 'Watch this expedition ↗' : 'Just watching? Spectate'}</button></section></div><p id="form-error" class="form-error" role="alert"></p></form>`,
    'ONLINE CO-OP',
  );
  $('#online-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const intent = (event as SubmitEvent).submitter?.getAttribute('value');
    const name = $<HTMLInputElement>('#player-name').value.trim();
    const code = $<HTMLInputElement>('#room-code-input')
      .value.trim()
      .toUpperCase();
    void safe(async () => {
      if (intent === 'create')
        await net.create(
          name,
          $<HTMLSelectElement>('#room-mode').value as 'duo' | 'party',
          $<HTMLSelectElement>('#room-turn-order')?.value as
            'alternating' | 'simultaneous',
          getSelectedCosmetic(),
        );
      else if (intent === 'watch') await net.watch(code);
      else await net.join(name, code, getSelectedCosmetic());
      if (room?.game) modal.close();
      else lobby();
    });
  });
}
async function daily() {
  if (room) {
    online();
    return;
  }
  showModal(
    'A new day. The same odds.',
    '<p>Every explorer gets the same seed. Fewest turns wins; time breaks ties.</p><div id="leaderboard"><p>Loading today’s challenge…</p></div><form id="daily-form"><label>Your name<input id="daily-name" maxlength="20" value="Explorer" required /></label><p id="form-error" class="form-error" role="alert"></p><button type="submit" class="button primary">Take the daily challenge ↗</button></form>',
    'DAILY CHALLENGE · UTC',
  );
  $('#daily-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void safe(async () => {
      await net.create(
        $<HTMLInputElement>('#daily-name').value.trim(),
        'daily',
        'alternating',
        getSelectedCosmetic(),
      );
      await net.start();
    });
  });
  try {
    const response = await fetch(`${API_URL}/api/daily`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    const data = (await response.json()) as {
      date: string;
      leaderboard: LeaderboardEntry[];
    };
    if (!$('#leaderboard')) return;
    $('#leaderboard').innerHTML =
      `<div class="section-heading"><h3>${escape(data.date)}</h3><span>TOP 20</span></div>${data.leaderboard.length ? `<table><thead><tr><th>Explorer</th><th>Turns</th><th>Time</th></tr></thead><tbody>${data.leaderboard.map((e) => `<tr><td>${escape(e.name)}</td><td>${e.turns}</td><td>${Math.floor(e.seconds / 60)}m ${e.seconds % 60}s</td></tr>`).join('')}</tbody></table>` : '<p>No escapes yet. Set the pace.</p>'}`;
  } catch {
    if ($('#leaderboard'))
      $('#leaderboard').innerHTML =
        '<p>The daily server is unavailable. Try again shortly, or play solo.</p>';
  }
}
function help() {
  showModal(
    'Your hand is your way out.',
    `<p>You don’t move with arrow keys. You move with cards.</p><ol class="instructions"><li><strong>Read the room.</strong> Red outlined tiles strike next round. Purple warnings charge for two rounds. Gold bomb markers become temporary embers next round. Small circles show their next move.</li><li><strong>Play your hand.</strong> Choose a card, then a highlighted tile. You get two plays per turn. Redraw is free. Grey cards stay selectable but have no valid targets right now. Clockwork dart is free with a two-round recharge.</li><li><strong>End your turn.</strong> In co-op, each living explorer acts before enemies attack and move. Unused cards are replaced next turn.</li><li><strong>Find the exit.</strong> Defeat every enemy, then reach the doorway. Choose one new card after each room, then choose a path when the trail forks. Reach the final Act to escape.</li></ol><div class="help-note">Hazards deal 1 damage when entered. Phase dash skips hazards along the path, but not at its destination. A shield blocks one hit. New rooms restore 3 HP and revive fallen teammates; players who leave stay out.</div><p>Co-op uses separate HP. Swap with any living ally, lend them a play, or taunt an enemy and step out of its new target tile.</p><button id="help-done" class="button primary">Make my first move ↗</button>`,
  );
  $('#help-done').onclick = () => modal.close();
}
net.onEmote = (data) => {
  const member = room?.members.find((m) => m.id === data.playerId);
  const name = member?.name ?? 'Explorer';
  toast(`${name}: ${data.emote}`);
};
net.onRoom = (next) => {
  const hadGame = Boolean(room?.game);
  room = next;
  if (next.game) {
    const prevPhase = game.phase;
    game = next.game;
    if (game.phase === 'won' && prevPhase !== 'won' && next.mode === 'daily') {
      incrementDailyCount();
    }
    selected = null;
    targets = [];
    if (!hadGame && modal.open) modal.close();
    render();
  } else {
    render();
    lobby();
  }
};
net.onStatus = (status) => {
  connection = status;
  render();
};
net.onError = (error) => {
  toast(error);
  if (!net.session && !net.watchCode) {
    room = null;
    connection = 'Local expedition';
    try {
      const saved = localStorage.getItem('chrono-local-v1');
      game = saved
        ? (JSON.parse(saved) as GameState)
        : createGame('solo', [{ id: 'local-1', name: 'You' }], seed());
    } catch {
      game = createGame('solo', [{ id: 'local-1', name: 'You' }], seed());
    }
    render();
  }
};
document.querySelectorAll<HTMLElement>('[data-mode]').forEach(
  (button) =>
    (button.onclick = () => {
      const mode = button.dataset.mode;
      if (mode === 'solo' || mode === 'duo') void newLocal(mode);
      else if (mode === 'ghost') showGhostModal();
      else if (mode === 'online') online();
      else void daily();
    }),
);
$('#end-turn').onclick = () => void act({ type: 'end' });
$('#new-run').onclick = () =>
  void newLocal(game.mode === 'duo' && !room ? 'duo' : 'solo');
$('#achievements-button').onclick = showAchievements;
$('#profile-button').onclick = showProfileModal;
auth.onChange = () => updateProfileBadge();
void auth.init().then(() => updateProfileBadge());
$('#cosmetics-button').onclick = showCosmeticsModal;
$('#help-button').onclick = help;
$('#sound-button').onclick = () => {
  sound = !sound;
  $('#sound-button').innerHTML = sound ? '🔊' : '🔇';
  $('#sound-button').title = `Sound: ${sound ? 'On' : 'Off'} (Click to toggle)`;
  $('#sound-button').setAttribute('aria-pressed', `${sound}`);
  beep('support');
};
$('#mobile-help').onclick = help;
modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      modal.close();
  }
});
document.addEventListener('keydown', (event) => {
  if (
    modal.open ||
    (event.target instanceof HTMLElement &&
      /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (/^[1-5]$/.test(event.key)) {
    event.preventDefault();
    if (Number(event.key) <= activePlayer(game).hand.length)
      selectCard(Number(event.key) - 1);
  } else if (event.key === 'Escape') setSelection(null);
  else if (event.key.toLowerCase() === 'e') void act({ type: 'end' });
  else if (event.key === '?') help();
});
render();
const params = new URLSearchParams(location.search);
if (net.session || net.watchCode)
  void net.connect().catch((error: Error) => toast(error.message));
else if (params.has('room') || params.has('watch'))
  online(params.get('room') ?? params.get('watch') ?? '', params.has('watch'));
