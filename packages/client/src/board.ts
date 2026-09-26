import Phaser from 'phaser';
import {
  activePlayer,
  ACTS,
  ENEMIES,
  LEVELS,
  same,
  type GameState,
  type Position,
} from '@chrono/shared';
import { palette, sprites } from './pixel-art';

const T = 32;
const themes = [
  {
    floor: 0x7f9279,
    light: 0x9eac89,
    shade: 0x697968,
    wall: 0x8b8591,
    edge: 0xb3adb0,
    moss: 0x548164,
  },
  {
    floor: 0xa08572,
    light: 0xb49c83,
    shade: 0x826c63,
    wall: 0x827285,
    edge: 0xad90a0,
    moss: 0x776850,
  },
  {
    floor: 0x7f8e9c,
    light: 0xa1adb1,
    shade: 0x647185,
    wall: 0x747d97,
    edge: 0x9da6bd,
    moss: 0x537d7d,
  },
  {
    floor: 0x899184,
    light: 0xb2ad8b,
    shade: 0x697969,
    wall: 0x89857c,
    edge: 0xbdb193,
    moss: 0x667c58,
  },
  {
    floor: 0x8e7d9a,
    light: 0xb3a0af,
    shade: 0x71647f,
    wall: 0x75758c,
    edge: 0xa4a1bb,
    moss: 0x537e84,
  },
];

interface TrackedPlayer {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Ellipse;
  cursor: Phaser.GameObjects.Text;
  shield: Phaser.GameObjects.Arc;
  tileX: number;
  tileY: number;
}

interface TrackedEnemy {
  charge: Phaser.GameObjects.Text;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  tileX: number;
  tileY: number;
  kind: string;
}

class Dungeon extends Phaser.Scene {
  state?: GameState;
  targets: Position[] = [];
  localPlayerId?: string;
  ready = false;
  renderedLevel = -1;
  renderedTilesKey = '';
  renderedSeed = -1;

  spawnCombatText(x: number, y: number, text: string, color = '#ffeb3b') {
    if (!this.ready || this.reduced()) return;
    const txt = this.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(20);
    this.tweens.add({
      targets: txt,
      y: y - 18,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy(),
    });
  }

  staticGraphics!: Phaser.GameObjects.Graphics;
  exitLockGraphics!: Phaser.GameObjects.Graphics;
  exitGlow!: Phaser.GameObjects.Rectangle;
  exitPos: Position = { x: 8, y: 8 };

  overlayGraphics!: Phaser.GameObjects.Graphics;
  entityBelowGraphics!: Phaser.GameObjects.Graphics;
  entityContainer!: Phaser.GameObjects.Container;
  ambientContainer!: Phaser.GameObjects.Container;
  fxContainer!: Phaser.GameObjects.Container;

  players = new Map<string, TrackedPlayer>();
  enemies = new Map<string, TrackedEnemy>();

  constructor() {
    super('Dungeon');
  }

  create() {
    for (const [name, rows] of Object.entries(sprites)) {
      const canvas = this.textures.createCanvas(
        name,
        Math.max(...rows.map((r) => r.length)),
        rows.length,
      )!;
      rows.forEach((row, y) =>
        [...row].forEach((p, x) => {
          if (palette[p]) {
            canvas.context.fillStyle = palette[p];
            canvas.context.fillRect(x, y, 1, 1);
          }
        }),
      );
      canvas.refresh();
    }

    this.staticGraphics = this.add.graphics().setDepth(0);
    this.exitGlow = this.add
      .rectangle(0, 0, 20, 23, 0xa9eec4, 0.35)
      .setDepth(1);
    this.exitGlow.setVisible(false);
    if (!this.reduced()) {
      this.tweens.add({
        targets: this.exitGlow,
        alpha: 0.12,
        duration: 900,
        yoyo: true,
        repeat: -1,
      });
    }
    this.exitLockGraphics = this.add.graphics().setDepth(2);
    this.overlayGraphics = this.add.graphics().setDepth(3);
    this.entityBelowGraphics = this.add.graphics().setDepth(4);
    this.entityContainer = this.add.container().setDepth(5);
    this.ambientContainer = this.add.container().setDepth(6);
    this.fxContainer = this.add.container().setDepth(7);

    this.createAmbient();

    this.ready = true;
    if (this.state) {
      this.paint();
    }
  }

  reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  createAmbient() {
    const sconces = this.add.graphics();
    this.ambientContainer.add(sconces);
    const sRect = (x: number, y: number, w: number, h: number, color: number) =>
      sconces.fillStyle(color).fillRect(x, y, w, h);

    for (const y of [2, 7]) {
      for (const x of [0, 9]) {
        const px = x * T + 16,
          py = y * T + 16;
        sRect(px - 4, py + 2, 8, 8, 0x3e3444);
        sRect(px - 3, py + 2, 6, 2, 0xb99768);
        sRect(px - 2, py + 7, 4, 3, 0x96714e);
        const glow = this.add.circle(px, py - 2, 19, 0xffc866, 0.1);
        this.ambientContainer.add(glow);
        const flame = this.add.graphics();
        flame.fillStyle(0xe77752).fillRect(-4, -4, 8, 7).fillRect(-2, -8, 5, 6);
        flame.fillStyle(0xffcb73).fillRect(-2, -5, 4, 7);
        flame.fillStyle(0xfff0ae).fillRect(-1, -2, 2, 4);
        flame.setPosition(px, py);
        this.ambientContainer.add(flame);
        if (!this.reduced()) {
          this.tweens.add({
            targets: flame,
            scaleY: 0.8,
            duration: 180 + (x + y) * 13,
            yoyo: true,
            repeat: -1,
          });
          this.tweens.add({
            targets: glow,
            alpha: 0.5,
            duration: 430,
            yoyo: true,
            repeat: -1,
          });
        }
      }
    }

    if (!this.reduced()) {
      for (let i = 0; i < 9; i++) {
        const mote = this.add.rectangle(
          38 + ((i * 43) % 247),
          39 + ((i * 61) % 245),
          1,
          1,
          0xffe8ac,
          0.5,
        );
        this.ambientContainer.add(mote);
        this.tweens.add({
          targets: mote,
          y: mote.y - 9,
          alpha: 0,
          duration: 1800 + i * 170,
          delay: i * 110,
          yoyo: true,
          repeat: -1,
        });
      }
    }
  }

  updateBoard(state: GameState, targets: Position[], localPlayerId?: string) {
    const prev = this.state;
    const prevLocal = this.localPlayerId;
    if (
      prev === state &&
      prevLocal === localPlayerId &&
      this.targets.length === targets.length &&
      this.targets.every((p, i) => same(p, targets[i]))
    )
      return;
    this.state = state;
    this.targets = targets;
    this.localPlayerId = localPlayerId;
    if (this.ready) {
      this.paint();
      if (
        prev &&
        prev.revision !== state.revision &&
        prev.players.some(
          (p) =>
            p.hp > (state.players.find((next) => next.id === p.id)?.hp ?? p.hp),
        ) &&
        !this.reduced()
      )
        this.cameras.main.shake(110, 0.004);

      if (prev && prev.revision !== state.revision && !this.reduced()) {
        if (prev.level !== state.level)
          this.cameras.main.flash(180, 255, 238, 184);

        // Enemy attack lunge and flash beat
        for (const prevE of prev.enemies) {
          const hitPlayer = prev.players.find(
            (p) =>
              prevE.intent.attack.some((target) => same(target, p)) &&
              p.hp >
                (state.players.find((next) => next.id === p.id)?.hp ?? p.hp),
          );
          if (hitPlayer) {
            const tracked = this.enemies.get(prevE.id);
            if (tracked) {
              const dx = hitPlayer.x - prevE.x;
              const dy = hitPlayer.y - prevE.y;
              const stepX = dx !== 0 ? Math.sign(dx) * 8 : 0;
              const stepY = dy !== 0 ? Math.sign(dy) * 8 : 0;
              tracked.sprite.setTint(0xff6b6b);
              this.tweens.add({
                targets: tracked.container,
                x: tracked.container.x + stepX,
                y: tracked.container.y + stepY,
                duration: 90,
                yoyo: true,
                ease: 'Quad.easeInOut',
                onComplete: () => {
                  tracked.sprite.clearTint();
                },
              });
            }
          }
        }

        // Combat popups: Player damage and shields
        for (const p of state.players) {
          const prevP = prev.players.find((x) => x.id === p.id);
          if (prevP && p.hp < prevP.hp) {
            this.spawnCombatText(
              p.x * T + 16,
              p.y * T + 2,
              `-${prevP.hp - p.hp}`,
              '#ff5e5e',
            );
          } else if (prevP && p.shield < prevP.shield) {
            this.spawnCombatText(
              p.x * T + 16,
              p.y * T + 2,
              'BLOCKED!',
              '#72b6bc',
            );
          }
        }
        // Combat popups: Enemy damage and defeat
        for (const e of state.enemies) {
          const prevE = prev.enemies.find((x) => x.id === e.id);
          if (prevE && e.hp < prevE.hp) {
            this.spawnCombatText(
              e.x * T + 16,
              e.y * T + 2,
              `-${prevE.hp - e.hp}`,
              '#efc565',
            );
          }
        }
        for (const prevE of prev.enemies) {
          if (!state.enemies.some((x) => x.id === prevE.id)) {
            this.spawnCombatText(
              prevE.x * T + 16,
              prevE.y * T + 2,
              'KO!',
              '#ff7373',
            );
          }
        }
        const latest = state.log[state.log.length - 1] ?? '';
        if (latest.includes('Combo strike!')) {
          const ap = activePlayer(state);
          this.spawnCombatText(
            ap.x * T + 16,
            ap.y * T - 10,
            'COMBO +1',
            '#ffd700',
          );
        }

        // Damage indicators
        for (const p of state.players) {
          const old = prev.players.find((player) => player.id === p.id);
          if (old && old.hp > p.hp) {
            const damage = this.add
              .text(p.x * T + 16, p.y * T - 2, `-${old.hp - p.hp}`, {
                fontFamily: 'monospace',
                fontSize: '10px',
                color: '#fff2b0',
                stroke: '#673f53',
                strokeThickness: 2,
              })
              .setOrigin(0.5);
            this.fxContainer.add(damage);
            this.tweens.add({
              targets: damage,
              y: damage.y - 14,
              alpha: 0,
              duration: 650,
              onComplete: () => damage.destroy(),
            });
          }
        }

        // Enemy death sparks
        if (prev.level === state.level)
          for (const enemy of prev.enemies)
            if (!state.enemies.some((next) => next.id === enemy.id)) {
              for (let i = 0; i < 6; i++) {
                const spark = this.add.rectangle(
                  enemy.x * T + 16,
                  enemy.y * T + 16,
                  2,
                  2,
                  i % 2 ? 0xffecb2 : 0xf3a67a,
                );
                this.fxContainer.add(spark);
                this.tweens.add({
                  targets: spark,
                  x: spark.x + Math.cos((i * Math.PI) / 3) * 13,
                  y: spark.y + Math.sin((i * Math.PI) / 3) * 13,
                  alpha: 0,
                  duration: 350,
                  onComplete: () => spark.destroy(),
                });
              }
            }
      }
    }
  }

  paint() {
    if (!this.state) return;
    const s = this.state;
    const tilesKey = s.tiles
      ? s.tiles.join('')
      : (LEVELS[s.level]?.tiles?.join('') ?? '');
    const isNewGame = this.renderedSeed !== s.seed;
    if (
      this.renderedLevel !== s.level ||
      this.renderedTilesKey !== tilesKey ||
      isNewGame
    ) {
      if (this.renderedLevel !== s.level || isNewGame) {
        for (const p of this.players.values()) {
          this.tweens.killTweensOf(p.container);
          p.container.destroy();
        }
        this.players.clear();
        for (const e of this.enemies.values()) {
          this.tweens.killTweensOf(e.container);
          e.container.destroy();
        }
        this.enemies.clear();
      }

      this.renderRoom(s.level);
      this.renderedLevel = s.level;
      this.renderedTilesKey = tilesKey;
      this.renderedSeed = s.seed;
    }
    this.renderEntities(s, this.targets);
  }

  renderRoom(level: number) {
    this.staticGraphics.clear();
    const actIndex = ACTS.findIndex((act) => act.id === LEVELS[level].actId);
    const actThemes = [themes[0], themes[2], themes[4]];
    const theme =
        actThemes[actIndex] ?? themes[level % themes.length] ?? themes[0],
      tiles = this.state?.tiles ?? LEVELS[level].tiles;
    const rect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
      alpha = 1,
    ) => this.staticGraphics.fillStyle(color, alpha).fillRect(x, y, w, h);

    const width = LEVELS[level]?.width ?? tiles[0]?.length ?? 10;
    const height = LEVELS[level]?.height ?? tiles.length;
    if (this.scale.width !== width * T || this.scale.height !== height * T) {
      this.scale.resize(width * T, height * T);
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x * T,
          py = y * T,
          tile = tiles[y][x],
          noise = (x * 17 + y * 31 + level * 7) % 11;
        if (tile === '#') {
          rect(px, py, 32, 32, 0x383747);
          rect(px + 1, py + 1, 30, 25, theme.wall);
          rect(px + 1, py + 1, 30, 3, theme.edge);
          rect(px + 1, py + 4, 2, 20, theme.edge);
          rect(px + 3, py + 13, 28, 2, 0x656171);
          rect(px + 15, py + 3, 2, 10, 0x656171);
          rect(px + 8, py + 15, 2, 10, 0x656171);
          rect(px + 27, py + 15, 2, 10, 0x656171);
          rect(px + 2, py + 25, 29, 3, 0x555363);
          rect(px + 3, py + 28, 26, 2, 0x464554);
          if (noise < 6)
            for (let k = 0; k < 4; k++) {
              rect(px + 3 + k * 3, py + 3 + (k % 2) * 2, 4, 3, theme.moss);
              rect(px + 5 + k * 3, py + 2 + (k % 2) * 2, 2, 1, 0x95af75);
            }
          if (y === 0 || (tiles[y - 1]?.[x] === '.' && noise < 5)) {
            rect(px + 20, py + 3, 2, 10, 0x3a6454);
            rect(px + 18, py + 7, 4, 2, 0x5c996c);
            rect(px + 21, py + 12, 4, 2, 0x77aa71);
          }
        } else if (tile === 'B') {
          rect(px, py, 32, 32, 0x2e2b38);
          rect(px + 1, py + 1, 30, 25, 0x635a6b);
          rect(px + 1, py + 1, 30, 3, 0x93889c);
          rect(px + 1, py + 4, 2, 20, 0x93889c);
          rect(px + 7, py + 5, 2, 8, 0xefc565);
          rect(px + 9, py + 12, 6, 2, 0xefc565);
          rect(px + 14, py + 14, 2, 9, 0xfff3a6);
          rect(px + 16, py + 21, 8, 2, 0xefc565);
          rect(px + 23, py + 7, 3, 4, 0x3d3845);
          rect(px + 5, py + 18, 4, 3, 0x3d3845);
          rect(px + 2, py + 25, 29, 3, 0x483e4f);
          rect(px + 3, py + 28, 26, 2, 0x352b3c);
        } else {
          rect(px, py, 32, 32, theme.shade);
          rect(px + 1, py + 1, 30, 30, theme.floor);
          rect(px + 2, py + 2, 28, 1, theme.light);
          rect(px + 2, py + 3, 1, 26, theme.light);
          rect(px + 3, py + 30, 27, 1, theme.shade);
          if (noise < 6) {
            rect(px + 8, py + 9, 2, 1, theme.light);
            rect(px + 23, py + 22, 2, 1, theme.light);
          }
          if (noise % 3 === 0) {
            rect(px + 19, py + 18, 1, 6, theme.shade);
            rect(px + 20, py + 23, 4, 1, theme.shade);
            rect(px + 18, py + 17, 3, 1, theme.shade);
          }
          if (tiles[y - 1]?.[x] === '#') rect(px, py, 32, 5, 0x343645, 0.3);
          if (tiles[y]?.[x - 1] === '#') rect(px, py, 4, 32, 0x343645, 0.2);
          if (noise < 3 && tile === '.') {
            rect(px + 4, py + 23, 1, 5, 0x3d7058);
            rect(px + 6, py + 21, 1, 7, 0x3d7058);
            rect(px + 8, py + 24, 1, 4, 0x3d7058);
            rect(px + 6, py + 20, 2, 2, noise === 0 ? 0xf2d080 : 0xaad197);
          }
          if (tile === '~') {
            rect(px + 4, py + 6, 24, 23, 0x594951);
            rect(px + 5, py + 7, 22, 2, 0xc4ab95);
            for (let k = 0; k < 3; k++) {
              rect(px + 8 + k * 7, py + 17, 4, 9, 0x788e9d);
              rect(px + 9 + k * 7, py + 13, 2, 12, 0xd6e6db);
              rect(px + 10 + k * 7, py + 11, 1, 4, 0xf3f1ce);
            }
          }
          if (tile === 'E') {
            this.exitPos = { x, y };
            this.exitGlow.setPosition(px + 16, py + 15);
            rect(px + 4, py + 3, 24, 27, 0x363f49);
            rect(px + 6, py + 5, 20, 24, 0x565973);
            for (let i = 0; i < 4; i++) {
              rect(px + 8, py + 8 + i * 5, 16, 2, 0xadacac);
              rect(px + 8, py + 10 + i * 5, 16, 3, 0x77788b);
            }
          }
        }
      }
    }
  }

  renderEntities(s: GameState, targets: Position[]) {
    // 1. Exit portal
    this.exitLockGraphics.clear();
    if (s.enemies.length) {
      this.exitGlow.setVisible(false);
      const ex = this.exitPos.x * T,
        ey = this.exitPos.y * T;
      const elRect = (
        x: number,
        y: number,
        w: number,
        h: number,
        color: number,
      ) => this.exitLockGraphics.fillStyle(color).fillRect(x, y, w, h);
      elRect(ex + 13, ey + 14, 7, 7, 0x5c484a);
      elRect(ex + 14, ey + 12, 5, 4, 0xebc770);
      elRect(ex + 14, ey + 16, 5, 4, 0xf7d988);
      elRect(ex + 16, ey + 16, 1, 3, 0x624d4d);
    } else {
      this.exitGlow.setVisible(true);
    }

    // 2. Overlays (danger telegraphs & card targets)
    this.overlayGraphics.clear();
    const oRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
      alpha = 1,
    ) => this.overlayGraphics.fillStyle(color, alpha).fillRect(x, y, w, h);

    const width = LEVELS[s.level]?.width ?? 10;
    const height = LEVELS[s.level]?.height ?? 10;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x * T,
          py = y * T;
        const hazard = (s.hazards ?? []).find(
          (h) => same(h, { x, y }) && h.expiresRound > s.round,
        );
        if (hazard) {
          oRect(px + 3, py + 3, 26, 26, 0xb6533c, 0.65);
          for (let k = 0; k < 3; k++) {
            oRect(px + 7 + k * 7, py + 13, 3, 12, 0xffbb66);
            oRect(px + 8 + k * 7, py + 10, 1, 10, 0xffeead);
          }
        }
        if (
          s.enemies.some((e) => e.intent.hazard?.some((p) => same(p, { x, y })))
        ) {
          oRect(px + 2, py + 2, 28, 2, 0xffc765);
          oRect(px + 2, py + 28, 28, 2, 0xffc765);
          oRect(px + 2, py + 2, 2, 28, 0xffc765);
          oRect(px + 28, py + 2, 2, 28, 0xffc765);
          oRect(px + 12, py + 12, 8, 8, 0x48324e);
          oRect(px + 15, py + 8, 2, 4, 0xffc765);
        }
        if (
          s.enemies.some((e) => e.intent.attack.some((p) => same(p, { x, y })))
        ) {
          const chargingOnly = !s.enemies.some(
            (e) =>
              !e.intent.charging &&
              e.intent.attack.some((p) => same(p, { x, y })),
          );
          oRect(
            px + 2,
            py + 2,
            28,
            28,
            chargingOnly ? 0x957bd1 : 0xcb545b,
            0.25,
          );
          for (const [cx, cy] of [
            [3, 3],
            [25, 3],
            [3, 25],
            [25, 25],
          ]) {
            oRect(px + cx, py + cy, 4, 1, 0xffbf8e);
            oRect(px + cx, py + cy, 1, 4, 0xffbf8e);
          }
          oRect(px + 15, py + 23, 2, 3, 0xffddad);
          oRect(px + 15, py + 27, 2, 1, 0xffddad);
        }
        if (targets.some((p) => same(p, { x, y }))) {
          oRect(px + 2, py + 2, 28, 28, 0xa9edc8, 0.26);
          for (const [cx, cy] of [
            [2, 2],
            [25, 2],
            [2, 25],
            [25, 25],
          ]) {
            oRect(px + cx, py + cy, 5, 2, 0xe8ffd4);
            oRect(px + cx, py + cy, 2, 5, 0xe8ffd4);
          }
          oRect(px + 15, py + 14, 2, 4, 0xe8ffd4);
          oRect(px + 14, py + 15, 4, 2, 0xe8ffd4);
        }
      }
    }

    // 3. Enemy move telegraph lines
    this.entityBelowGraphics.clear();
    for (const e of s.enemies) {
      if (e.intent.move) {
        const x = e.x * T + 16,
          y = e.y * T + 16;
        const dx = e.intent.move.x * T + 16,
          dy = e.intent.move.y * T + 16;
        this.entityBelowGraphics
          .lineStyle(1, 0xffe6b3, 0.7)
          .lineBetween(x, y, dx, dy);
        this.entityBelowGraphics.strokeRect(dx - 2, dy - 2, 4, 4);
      }
    }

    // 4. Tracked Enemies (smooth slide on move)
    const activeEnemyIds = new Set(s.enemies.map((e) => e.id));
    for (const [id, tracked] of this.enemies.entries()) {
      if (!activeEnemyIds.has(id)) {
        this.tweens.killTweensOf(tracked.container);
        tracked.container.destroy();
        this.enemies.delete(id);
      }
    }

    for (const e of s.enemies) {
      const targetPx = e.x * T + 16;
      const targetPy = e.y * T + 16;
      let tracked = this.enemies.get(e.id);
      if (tracked && tracked.kind !== e.kind) {
        this.tweens.killTweensOf(tracked.container);
        tracked.container.destroy();
        this.enemies.delete(e.id);
        tracked = undefined;
      }

      if (!tracked) {
        const container = this.add.container(targetPx, targetPy);
        const shadow = this.add.ellipse(0, 10, 22, 7, 0x303545, 0.35);
        const sprite = this.add.image(0, -2, e.kind);
        const hpBg = this.add.rectangle(0, 13, 10, 2, 0x403244);
        const maxHp = ENEMIES[e.kind]?.hp ?? 2;
        const fillW = Math.max(0, (e.hp / maxHp) * 8);
        const hpFg = this.add.rectangle(-4 + fillW / 2, 13, fillW, 1, 0xf48f81);
        const charge = this.add
          .text(0, -20, '', {
            fontFamily: 'monospace',
            fontSize: '7px',
            color: '#fff1b8',
            backgroundColor: '#493457',
          })
          .setOrigin(0.5);

        container.add([shadow, sprite, hpBg, hpFg, charge]);
        this.entityContainer.add(container);

        if (!this.reduced()) {
          this.tweens.add({
            targets: sprite,
            y: -2 - (e.kind === 'chaser' ? 4 : 3),
            duration: e.kind === 'chaser' ? 650 : 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: e.x * 50,
          });
        }

        tracked = {
          container,
          sprite,
          shadow,
          hpBg,
          hpFg,
          tileX: e.x,
          tileY: e.y,
          kind: e.kind,
          charge,
        };
        this.enemies.set(e.id, tracked);
      } else {
        const maxHp = ENEMIES[e.kind]?.hp ?? 2;
        const fillW = Math.max(0, (e.hp / maxHp) * 8);
        tracked.hpFg.setSize(fillW, 1);
        tracked.hpFg.setPosition(-4 + fillW / 2, 13);

        if (tracked.tileX !== e.x || tracked.tileY !== e.y) {
          if (!this.reduced()) {
            this.tweens.killTweensOf(tracked.container);
            this.tweens.add({
              targets: tracked.container,
              x: targetPx,
              y: targetPy,
              duration: 180,
              ease: 'Quad.easeOut',
            });
          } else {
            tracked.container.setPosition(targetPx, targetPy);
          }
          tracked.tileX = e.x;
          tracked.tileY = e.y;
        } else if (!this.tweens.isTweening(tracked.container)) {
          tracked.container.setPosition(targetPx, targetPy);
        }
      }
      tracked.charge.setText(
        e.intent.charging
          ? 'CHARGE 2'
          : e.kind.endsWith('_elite')
            ? 'READY 1'
            : '',
      );
    }

    const activePlayerIds = new Set(s.players.map((p) => p.id));
    for (const [id, tracked] of this.players.entries()) {
      if (!activePlayerIds.has(id)) {
        this.tweens.killTweensOf(tracked.container);
        tracked.container.destroy();
        this.players.delete(id);
      }
    }

    s.players.forEach((p, i) => {
      let tracked = this.players.get(p.id);
      if (p.hp <= 0) {
        if (tracked) tracked.container.setVisible(false);
        return;
      }

      const targetPx = p.x * T + 16;
      const targetPy = p.y * T + 16;
      const isActive = p.id === activePlayer(s).id;
      const isLocal = this.localPlayerId
        ? p.id === this.localPlayerId
        : isActive;
      const isGhost =
        p.id === 'ghost-1' || p.name.toLowerCase().includes('ghost');

      const showCursor = isLocal || isGhost;
      const cursorText = isGhost
        ? '▼ (ghost)'
        : isLocal
          ? s.players.length > 1
            ? '▼ YOU'
            : '▼'
          : '';
      const cursorColor = isGhost
        ? '#88eeff'
        : isLocal
          ? isActive
            ? '#fff1af'
            : '#7affc8'
          : '#fff1af';

      if (!tracked) {
        const container = this.add.container(targetPx, targetPy);
        const shadow = this.add.ellipse(0, 10, 21, 7, 0x293b42, 0.4);
        const ring = this.add
          .ellipse(0, 9, 23, 8)
          .setStrokeStyle(1, 0xffeb9a)
          .setVisible(isActive);
        const cursor = this.add
          .text(0, -20, cursorText, {
            fontFamily: 'monospace',
            fontSize: isGhost ? '7px' : '8px',
            color: cursorColor,
          })
          .setOrigin(0.5)
          .setVisible(showCursor);

        if (!this.reduced()) {
          this.tweens.add({
            targets: cursor,
            y: -22,
            duration: 500,
            yoyo: true,
            repeat: -1,
          });
        }

        const sprite = this.add.image(0, -1, 'explorer');
        if (isGhost) {
          sprite.setTint(0x78e6ff);
          sprite.setAlpha(0.72);
        } else if (isLocal) {
          try {
            const skin = localStorage.getItem('chrono-skin');
            const cosmeticTints: Record<string, number> = {
              void: 0xcc99ff,
              solar: 0xffd275,
              chrono: 0x78e6ff,
            };
            if (skin && cosmeticTints[skin])
              sprite.setTint(cosmeticTints[skin]);
            else
              sprite.setTint([0xffffff, 0x9cd8ff, 0xffc496, 0xe0b9ff][i % 4]);
          } catch {
            sprite.setTint([0xffffff, 0x9cd8ff, 0xffc496, 0xe0b9ff][i % 4]);
          }
        } else {
          sprite.setTint([0xffffff, 0x9cd8ff, 0xffc496, 0xe0b9ff][i % 4]);
        }

        const bubble = this.add
          .circle(0, -2, 14, 0x9fe4ef, 0.12)
          .setStrokeStyle(1, 0xd4ffec, 0.8)
          .setVisible(Boolean(p.shield));

        if (!this.reduced()) {
          this.tweens.add({
            targets: bubble,
            alpha: 0.45,
            duration: 800,
            yoyo: true,
            repeat: -1,
          });
        }

        container.add([shadow, ring, cursor, sprite, bubble]);
        this.entityContainer.add(container);

        tracked = {
          container,
          sprite,
          shadow,
          ring,
          cursor,
          shield: bubble,
          tileX: p.x,
          tileY: p.y,
        };
        this.players.set(p.id, tracked);
      }
      // Reconcile existing sprites on every state update, not only on creation.
      tracked.ring.setVisible(isActive);
      tracked.cursor.setVisible(showCursor);
      tracked.cursor.setText(cursorText);
      tracked.cursor.setColor(cursorColor);
      tracked.shield.setVisible(Boolean(p.shield));
      tracked.container.setVisible(true);

      if (tracked.tileX !== p.x || tracked.tileY !== p.y) {
        if (!this.reduced()) {
          this.tweens.killTweensOf(tracked.container);
          this.tweens.add({
            targets: tracked.container,
            x: targetPx,
            y: targetPy,
            duration: 180,
            ease: 'Quad.easeOut',
          });
        } else {
          tracked.container.setPosition(targetPx, targetPy);
        }
        tracked.tileX = p.x;
        tracked.tileY = p.y;
      } else if (!this.tweens.isTweening(tracked.container)) {
        tracked.container.setPosition(targetPx, targetPy);
      }
    });
  }
}

export function createBoard(parent: HTMLElement) {
  const scene = new Dungeon();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 320,
    height: 320,
    parent,
    backgroundColor: '#393747',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    audio: { noAudio: true },
    scene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    banner: false,
  });
  return {
    update: (state: GameState, targets: Position[], localPlayerId?: string) =>
      scene.updateBoard(state, targets, localPlayerId),
    destroy: () => game.destroy(true),
  };
}
