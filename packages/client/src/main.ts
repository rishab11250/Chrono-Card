import './style.css';
import {
  activePlayer,
  applyAction,
  CARDS,
  createGame,
  ENEMIES,
  legalTargets,
  LEVELS,
  same,
  type GameAction,
  type GameState,
  type LeaderboardEntry,
  type Position,
  type RoomView,
} from '@chrono/shared';
import { API_URL, Network } from './net';
import { icon } from './icons';

type Board = {
  update: (state: GameState, targets: Position[]) => void;
  destroy: () => void;
};
let boardInstance: Board | null = null;
let boardLoading: Promise<Board> | null = null;

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
let game: GameState;
let room: RoomView | null = null;
let selected: number | null = null;
let targets: Position[] = [];
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

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Chrono Card home"><span class="brand-mark">${hourglass}</span><span>CHRONO<span class="brand-second">CARD<span class="brand-dot">.</span></span></span></a>
    <div class="sidebar-label">THE EXPEDITION</div>
    <nav aria-label="Game modes">
      <button class="nav-item" data-mode="solo" aria-label="Solo adventure"><span class="nav-symbol">${icon('explorer')}</span>Solo adventure<span class="nav-tail">↗</span></button>
      <button class="nav-item" data-mode="duo" aria-label="Couch co-op"><span class="nav-symbol">${icon('duo')}</span>Couch co-op<span class="nav-tail">2</span></button>
      <button class="nav-item" data-mode="online"><span class="nav-symbol">${icon('shield')}</span>Play with friends<span class="nav-tail">↗</span></button>
      <button class="nav-item" data-mode="daily"><span class="nav-symbol">${icon('boost')}</span>Daily challenge<span class="tiny-dot"></span></button>
    </nav>
    <div class="sidebar-note"><span class="note-star">✧</span><p>A little strategy.<br>A little borrowed time.</p><div class="note-line"></div><small>No reflexes required.<br>Make every card count.</small></div>
    <div class="sidebar-bottom"><button id="help-button" class="quiet-button">ⓘ &nbsp; How to play <kbd>?</kbd></button><button id="sound-button" class="quiet-button" aria-pressed="false">♫ &nbsp; Sound off</button><div class="version"><span class="tiny-dot"></span> BUILT FOR THE NEXT MOVE <span>V1.0</span></div></div>
  </aside>
  <main>
    <header class="topbar"><div class="breadcrumb">ADVENTURE <span>►</span> <strong id="mode-label">SOLO ADVENTURE</strong></div><div class="top-actions"><span id="connection" class="connection">Local expedition</span><button id="mobile-help" class="button subtle small" aria-label="Game instructions">?</button><button id="new-run" class="button subtle small">↻ <span>New expedition</span></button></div></header>
    <div class="workspace">
      <section class="room-heading"><div><div class="eyebrow" id="chapter-label">CHAPTER 01 / 05</div><h1 id="room-name">The Threshold</h1><p id="room-subtitle">Every escape begins with a single step.</p></div><div class="room-progress" id="room-progress" aria-label="Dungeon progress"></div></section>
      <div class="play-layout">
        <section class="dungeon-panel" aria-label="Dungeon board"><div class="board-toolbar"><span><i class="live-dot"></i><strong id="turn-label">YOUR TURN</strong></span><span id="round-label">ROUND 01</span></div><div class="board-wrap"><div id="phaser-board"></div><div id="accessible-grid" class="accessible-grid" role="group" aria-label="Dungeon tiles. Select a card, then a tile. Arrow keys move focus; Enter selects."></div><div id="outcome" class="outcome" hidden></div></div><div class="board-legend"><span><i class="legend-player"></i> Explorer</span><span><i class="legend-danger"></i> Next attack</span><span><i class="legend-exit"></i> Exit</span><span class="legend-hint">PLAN. PLAY. REPEAT.</span></div></section>
        <aside class="run-panel"><section class="party-section"><div class="section-heading"><h2>YOUR PARTY</h2><span id="party-count">01</span></div><div id="party"></div></section><section class="enemy-section"><div class="section-heading"><h2>IN THE SHADOWS</h2><span id="enemy-count">02</span></div><div id="enemies"></div></section><section class="log-section"><div class="section-heading"><h2>FIELD NOTES</h2><span>↙</span></div><ol id="field-notes"></ol></section><div class="exit-note" id="exit-note"><span>▥</span><p>Clear the room.<br><strong>Find your way out.</strong></p></div></aside>
      </div>
      <section class="hand-section" aria-label="Your cards"><div class="hand-heading"><div><h2 id="hand-title">Your next move<span id="plays-badge">2 plays left</span></h2><p id="selection-hint">Choose a card, then a highlighted tile.</p></div><button id="end-turn" class="button primary">End turn <span>↗</span></button></div><div id="hand" class="hand"></div></section>
      <footer class="game-footer"><span>THE DUNGEON MOVES ONLY WHEN YOU DO.</span><span><kbd>1</kbd>–<kbd>5</kbd> select card <span class="footer-separator">/</span> <kbd>Esc</kbd> cancel <span class="footer-separator">/</span> <kbd>E</kbd> end turn</span></footer>
    </div>
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="modal" aria-labelledby="modal-title"><div id="modal-content"></div></dialog>
`;
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
  targets = index === null ? [] : legalTargets(game, index);
  render();
}
async function act(action: GameAction) {
  if (!canPlay()) return;
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
function selectCard(index: number) {
  if (!canPlay() || game.plays < 1) return;
  if (selected === index) {
    setSelection(null);
    return;
  }
  const id = activePlayer(game).hand[index];
  if (id === 'redraw') {
    void act({ type: 'play', card: index });
    return;
  }
  setSelection(index);
  if (
    window.innerWidth <= 700 &&
    $('.board-wrap').getBoundingClientRect().top < 0
  )
    $('.board-wrap').scrollIntoView({ block: 'center', behavior: 'instant' });
  if (!targets.length)
    toast(
      'No valid targets for this card. Choose another card or end your turn.',
    );
}
function tileLabel(x: number, y: number) {
  const position = { x, y };
  const tile = LEVELS[game.level].tiles[y][x];
  const player = game.players.find((p) => p.hp > 0 && same(p, position));
  const enemy = game.enemies.find((e) => same(e, position));
  return `Column ${x + 1}, row ${y + 1}: ${player ? `${player.name}, ${player.hp} HP` : enemy ? `${ENEMIES[enemy.kind].name}, ${enemy.hp} HP` : tile === '#' ? 'wall' : tile === '~' ? 'hazard, 1 damage' : tile === 'E' ? `exit ${game.enemies.length ? 'locked' : 'open'}` : 'floor'}${game.enemies.some((e) => e.intent.attack.some((p) => same(p, position))) ? ', enemy will attack here' : ''}${targets.some((p) => same(p, position)) ? ', valid target' : ''}`;
}
const grid = $('#accessible-grid');
for (let y = 0; y < 10; y++)
  for (let x = 0; x < 10; x++) {
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
grid.addEventListener('keydown', (event) => {
  const deltas: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -10,
    ArrowDown: 10,
  };
  if (!(event.key in deltas)) return;
  event.preventDefault();
  const cells = [...grid.children] as HTMLButtonElement[];
  const current = cells.indexOf(document.activeElement as HTMLButtonElement);
  const next = Math.max(0, Math.min(99, current + deltas[event.key]));
  cells[current].tabIndex = -1;
  cells[next].tabIndex = 0;
  cells[next].focus();
});
function render() {
  const p = activePlayer(game);
  const level = LEVELS[game.level];
  const playable = canPlay();
  const modeText = room
    ? room.mode === 'daily'
      ? 'DAILY CHALLENGE'
      : `ONLINE ${room.mode === 'duo' ? 'DUO' : 'PARTY'} · ${room.code}`
    : game.mode === 'duo'
      ? 'COUCH CO-OP'
      : 'SOLO ADVENTURE';
  $('#mode-label').textContent = modeText;
  $('#connection').textContent = room ? connection : 'Local expedition';
  $('#chapter-label').textContent =
    `CHAPTER ${String(game.level + 1).padStart(2, '0')} / 05`;
  $('#room-name').textContent = level.name;
  $('#room-subtitle').textContent = level.subtitle;
  $('#room-progress').innerHTML = LEVELS.map(
    (l, i) =>
      `<span class="progress-step ${i < game.level ? 'complete' : i === game.level ? 'current' : ''}" title="${escape(l.name)}">${i < game.level ? '✓' : String(i + 1).padStart(2, '0')}</span>${i < 4 ? '<i></i>' : ''}`,
  ).join('');
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => {
    const current =
      el.dataset.mode ===
      (room ? (room.mode === 'daily' ? 'daily' : 'online') : game.mode);
    el.classList.toggle('active', current);
    el.setAttribute('aria-current', current ? 'page' : 'false');
  });
  $('#turn-label').textContent =
    room && !room.game
      ? 'PARTY IS GATHERING'
      : game.phase !== 'playing'
        ? 'EXPEDITION COMPLETE'
        : room?.paused
          ? 'WAITING FOR RECONNECT'
          : room && !net.session
            ? 'SPECTATING'
            : playable
              ? game.players.length === 1
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
          ? `${selectedCard.name}: ${selectedCard.description}`
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
      return `<button class="card ${card.category} ${selected === index ? 'selected' : ''}" data-card="${index}" aria-pressed="${selected === index}" ${!playable || game.plays < 1 ? 'disabled' : ''}><span class="card-top"><span>${card.category.toUpperCase()}</span><kbd>${index + 1}</kbd></span><span class="card-art" aria-hidden="true"><span class="art-orbit"></span><span>${icon(id)}</span><i>✦</i></span><strong>${card.name}</strong><span class="card-description">${card.description}</span><span class="card-bottom">${id === 'redraw' ? 'FREE PLAY' : '1 PLAY'}<span>${card.category === 'move' ? '↗' : card.category === 'attack' ? '✧' : '◇'}</span></span></button>`;
    })
    .join('');
  document
    .querySelectorAll<HTMLButtonElement>('[data-card]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        selectCard(Number(button.dataset.card)),
      ),
    );
  for (const cell of grid.children as HTMLCollectionOf<HTMLButtonElement>) {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    cell.setAttribute('aria-label', tileLabel(x, y));
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
  if (boardInstance) {
    boardInstance.update(game, targets);
  } else if (!inLobby) {
    void loadBoard().then((b) => b.update(game, targets));
  }
  $('#outcome').hidden = game.phase === 'playing';
  if (game.phase !== 'playing') {
    $('#outcome').innerHTML =
      `<div class="outcome-card"><span>${game.phase === 'won' ? '✧' : '⌛'}</span><div class="eyebrow">${game.phase === 'won' ? 'THE CYCLE IS BROKEN' : 'EVERY END IS A BEGINNING'}</div><h2>${game.phase === 'won' ? 'Time is yours.' : 'Out of time.'}</h2><p>${game.phase === 'won' ? `Five rooms. ${game.turns} turns. One well-earned escape.` : `You reached room ${game.level + 1}. A new hand awaits.`}</p><button id="play-again" class="button primary">Another expedition ↗</button>${room?.mode === 'daily' && game.phase === 'won' ? '<p>Your score is on today’s leaderboard.</p>' : ''}</div>`;
    $('#play-again').addEventListener('click', () => void newLocal('solo'));
  }
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
  game = createGame(
    mode,
    mode === 'duo'
      ? [
          { id: 'local-1', name: 'Explorer 1' },
          { id: 'local-2', name: 'Explorer 2' },
        ]
      : [{ id: 'local-1', name: 'You' }],
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
    `<p>${room.mode === 'daily' ? 'The same dungeon and deck seed for everyone today. Finish the run to record your score.' : 'Share your code. Gather your party. Make it out together.'}</p><div class="room-code"><span>ROOM CODE</span><strong>${room.code}</strong><button id="copy-invite" class="text-button">Copy invite link ↗</button></div><div class="lobby-members">${room.members.map((m, i) => `<div><span class="member-number">0${i + 1}</span><strong>${escape(m.name)}</strong><span>${m.connected ? (m.id === room!.host ? 'HOST · READY' : 'READY') : 'RECONNECTING'}</span></div>`).join('')}${room.mode !== 'daily' && room.members.length < (room.mode === 'duo' ? 2 : 4) ? '<div class="waiting-slot">+ Waiting for another explorer…</div>' : ''}</div><p id="form-error" class="form-error" role="alert"></p><div class="dialog-actions"><button id="leave-lobby" class="button subtle">Leave room</button><button id="start-room" class="button primary" data-network ${!host || room.members.some((m) => !m.connected) || (room.mode !== 'daily' && room.members.length < 2) ? 'disabled' : ''}>${host ? 'Begin expedition ↗' : 'Waiting for host…'}</button></div><button id="spectator-link" class="text-button">Copy spectator link</button>`,
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
    `<p>Two to four explorers. One dungeon. A plan worth sharing.</p><form id="online-form"><label>Your name<input id="player-name" name="name" maxlength="20" value="Explorer" required autocomplete="nickname" /></label><div class="online-columns"><section><h3>Start something.</h3><p>A private room for your next adventure.</p><label>Party size<select id="room-mode"><option value="party">2–4 explorers</option><option value="duo">Duo · 2 explorers</option></select></label><button class="button primary" type="submit" name="intent" value="create">Create a room ↗</button></section><section><h3>Find your people.</h3><label>Room code<input id="room-code-input" name="code" maxlength="6" placeholder="ABC234" value="${escape(prefill)}" autocomplete="off" autocapitalize="characters" /></label><button class="button subtle" type="submit" name="intent" value="join">Join expedition ↗</button><button class="text-button" type="submit" name="intent" value="watch">${watch ? 'Watch this expedition ↗' : 'Just watching? Spectate'}</button></section></div><p id="form-error" class="form-error" role="alert"></p></form>`,
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
        );
      else if (intent === 'watch') await net.watch(code);
      else await net.join(name, code);
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
    `<p>You don’t move with arrow keys. You move with cards.</p><ol class="instructions"><li><strong>Read the room.</strong> Red outlined tiles are exactly where enemies will strike. Small circles show their next move.</li><li><strong>Play your hand.</strong> Choose a card, then a highlighted tile. You get two plays per turn. Redraw is free.</li><li><strong>End your turn.</strong> In co-op, each living explorer acts before enemies attack and move. Unused cards are replaced next turn.</li><li><strong>Find the exit.</strong> Defeat every enemy, then reach the doorway. Clear five rooms to escape.</li></ol><div class="help-note">Hazards deal 1 damage when entered. Phase dash skips hazards along the path, but not at its destination. A shield blocks one hit. New rooms restore 3 HP and revive fallen teammates; players who leave stay out.</div><p>Co-op uses separate HP. Swap with any living ally, lend them a play, or taunt an enemy and step out of its new target tile.</p><button id="help-done" class="button primary">Make my first move ↗</button>`,
  );
  $('#help-done').onclick = () => modal.close();
}
net.onRoom = (next) => {
  const hadGame = Boolean(room?.game);
  room = next;
  if (next.game) {
    game = next.game;
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
      else if (mode === 'online') online();
      else void daily();
    }),
);
$('#end-turn').onclick = () => void act({ type: 'end' });
$('#new-run').onclick = () =>
  void newLocal(game.mode === 'duo' && !room ? 'duo' : 'solo');
$('#help-button').onclick = help;
$('#sound-button').onclick = () => {
  sound = !sound;
  $('#sound-button').innerHTML = `♫ &nbsp; Sound ${sound ? 'on' : 'off'}`;
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
