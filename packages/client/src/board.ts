import Phaser from 'phaser';
import {
  activePlayer,
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
class Dungeon extends Phaser.Scene {
  state?: GameState;
  targets: Position[] = [];
  ready = false;
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
    this.ready = true;
    this.paint();
  }
  reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  updateBoard(state: GameState, targets: Position[]) {
    const prev = this.state;
    // HUD-only renders must not restart idle motion or erase a hit effect.
    if (
      prev === state &&
      this.targets.length === targets.length &&
      this.targets.every((p, i) => same(p, targets[i]))
    )
      return;
    this.state = state;
    this.targets = targets;
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
            this.tweens.add({
              targets: damage,
              y: damage.y - 14,
              alpha: 0,
              duration: 650,
              onComplete: () => damage.destroy(),
            });
          }
        }
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
    this.tweens.killAll();
    this.children.removeAll(true);
    const s = this.state,
      theme = themes[s.level],
      g = this.add.graphics(),
      tiles = LEVELS[s.level].tiles;
    const rect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
      alpha = 1,
    ) => g.fillStyle(color, alpha).fillRect(x, y, w, h);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const px = x * T,
          py = y * T,
          tile = tiles[y][x],
          noise = (x * 17 + y * 31 + s.level * 7) % 11;
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
            rect(px + 4, py + 3, 24, 27, 0x363f49);
            rect(px + 6, py + 5, 20, 24, 0x565973);
            for (let i = 0; i < 4; i++) {
              rect(px + 8, py + 8 + i * 5, 16, 2, 0xadacac);
              rect(px + 8, py + 10 + i * 5, 16, 3, 0x77788b);
            }
            if (s.enemies.length) {
              rect(px + 13, py + 14, 7, 7, 0x5c484a);
              rect(px + 14, py + 12, 5, 4, 0xebc770);
              rect(px + 14, py + 16, 5, 4, 0xf7d988);
              rect(px + 16, py + 16, 1, 3, 0x624d4d);
            } else {
              const glow = this.add.rectangle(
                px + 16,
                py + 15,
                20,
                23,
                0xa9eec4,
                0.35,
              );
              if (!this.reduced())
                this.tweens.add({
                  targets: glow,
                  alpha: 0.12,
                  duration: 900,
                  yoyo: true,
                  repeat: -1,
                });
            }
          }
          if (
            s.enemies.some((e) =>
              e.intent.attack.some((p) => same(p, { x, y })),
            )
          ) {
            rect(px + 2, py + 2, 28, 28, 0xcb545b, 0.25);
            for (const [cx, cy] of [
              [3, 3],
              [25, 3],
              [3, 25],
              [25, 25],
            ]) {
              rect(px + cx, py + cy, 4, 1, 0xffbf8e);
              rect(px + cx, py + cy, 1, 4, 0xffbf8e);
            }
            rect(px + 15, py + 23, 2, 3, 0xffddad);
            rect(px + 15, py + 27, 2, 1, 0xffddad);
          }
        }
        if (this.targets.some((p) => same(p, { x, y }))) {
          rect(px + 2, py + 2, 28, 28, 0xa9edc8, 0.26);
          for (const [cx, cy] of [
            [2, 2],
            [25, 2],
            [2, 25],
            [25, 25],
          ]) {
            rect(px + cx, py + cy, 5, 2, 0xe8ffd4);
            rect(px + cx, py + cy, 2, 5, 0xe8ffd4);
          }
          rect(px + 15, py + 14, 2, 4, 0xe8ffd4);
          rect(px + 14, py + 15, 4, 2, 0xe8ffd4);
        }
      }
    for (const e of s.enemies) {
      const x = e.x * T + 16,
        y = e.y * T + 16;
      g.fillStyle(0x303545, 0.35).fillEllipse(x, y + 10, 22, 7);
      if (e.intent.move) {
        const dx = e.intent.move.x * T + 16,
          dy = e.intent.move.y * T + 16;
        g.lineStyle(1, 0xffe6b3, 0.7).lineBetween(x, y, dx, dy);
        g.strokeRect(dx - 2, dy - 2, 4, 4);
      }
      const sprite = this.add.image(x, y - 2, e.kind);
      if (!this.reduced())
        this.tweens.add({
          targets: sprite,
          y: y - (e.kind === 'chaser' ? 4 : 3),
          duration: e.kind === 'chaser' ? 650 : 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: e.x * 50,
        });
      rect(x - 5, y + 13, 10, 2, 0x403244);
      rect(x - 4, y + 13, 8, 1, 0xf48f81);
    }
    s.players.forEach((p, i) => {
      if (p.hp <= 0) return;
      const x = p.x * T + 16,
        y = p.y * T + 16;
      g.fillStyle(0x293b42, 0.4).fillEllipse(x, y + 10, 21, 7);
      if (p.id === activePlayer(s).id) {
        g.lineStyle(1, 0xffeb9a).strokeEllipse(x, y + 9, 23, 8);
        const cursor = this.add
          .text(x, y - 20, '▼', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#fff1af',
          })
          .setOrigin(0.5);
        if (!this.reduced())
          this.tweens.add({
            targets: cursor,
            y: y - 22,
            duration: 500,
            yoyo: true,
            repeat: -1,
          });
      }
      const sprite = this.add.image(x, y - 1, 'explorer');
      if (i > 0) sprite.setTint([0xffffff, 0x9cd8ff, 0xffc496, 0xe0b9ff][i]);
      if (p.shield) {
        const bubble = this.add
          .circle(x, y - 2, 14, 0x9fe4ef, 0.12)
          .setStrokeStyle(1, 0xd4ffec, 0.8);
        if (!this.reduced())
          this.tweens.add({
            targets: bubble,
            alpha: 0.45,
            duration: 800,
            yoyo: true,
            repeat: -1,
          });
      }
    });
    for (const y of [2, 7])
      for (const x of [0, 9]) {
        const px = x * T + 16,
          py = y * T + 16;
        rect(px - 4, py + 2, 8, 8, 0x3e3444);
        rect(px - 3, py + 2, 6, 2, 0xb99768);
        rect(px - 2, py + 7, 4, 3, 0x96714e);
        const glow = this.add.circle(px, py - 2, 19, 0xffc866, 0.1);
        const flame = this.add.graphics();
        flame.fillStyle(0xe77752).fillRect(-4, -4, 8, 7).fillRect(-2, -8, 5, 6);
        flame.fillStyle(0xffcb73).fillRect(-2, -5, 4, 7);
        flame.fillStyle(0xfff0ae).fillRect(-1, -2, 2, 4);
        flame.setPosition(px, py);
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
    if (!this.reduced())
      for (let i = 0; i < 9; i++) {
        const mote = this.add.rectangle(
          38 + ((i * 43) % 247),
          39 + ((i * 61) % 245),
          1,
          1,
          0xffe8ac,
          0.5,
        );
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
    update: (state: GameState, targets: Position[]) =>
      scene.updateBoard(state, targets),
    destroy: () => game.destroy(true),
  };
}
