import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import type { GameState, Level } from '../../packages/shared/src/types';
// Playwright's native ESM loader does not transform the shared package's JSON imports.
// Generate real engine fixtures through the project's tsx runtime instead of duplicating rules.
const fixtures = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
import {createGame,applyAction,LEVELS} from './packages/shared/src/index.ts';
const game=createGame('solo',[{id:'local-1',name:'You'}],123);
const exit=structuredClone(game);exit.enemies=[];Object.assign(exit.players[0],{x:8,y:8});
console.log(JSON.stringify({game,draft:applyAction(exit,'local-1',{type:'end'}),levels:LEVELS}));
`,
    ],
    { encoding: 'utf8' },
  ),
) as { game: GameState; draft: GameState; levels: Level[] };
const solo = () => structuredClone(fixtures.game);
const LEVELS = fixtures.levels;
async function restore(page: Page, state: GameState) {
  await page.addInitScript(
    (state) => localStorage.setItem('chrono-local-v1', JSON.stringify(state)),
    state,
  );
  await page.goto('/');
  await expect(page.locator('#phaser-board canvas')).toBeVisible();
}
test('previews every hand card, keeps useless cards selectable, and refreshes usefulness after movement', async ({
  page,
}) => {
  const s = solo();
  s.players[0].hand = ['strike', 'step1', 'shield', 'redraw', 'quickshot'];
  s.enemies = [
    {
      id: 'e',
      x: 3,
      y: 1,
      kind: 'turret',
      hp: 2,
      heading: 0,
      intent: { attack: [] },
    },
  ];
  await restore(page, s);
  const strike = page.getByRole('button', { name: 'Iron edge', exact: true });
  await expect(strike).toHaveClass(/not-useful/);
  await expect(strike).toBeEnabled();
  await expect(strike).toHaveAccessibleDescription(
    /No valid targets right now/,
  );
  await strike.focus();
  await page.keyboard.press('Enter');
  await expect(strike).toBeFocused();
  await expect(strike).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#selection-hint')).toContainText(
    'No valid targets for this card',
  );
  await expect(page.locator('#accessible-grid')).toHaveAttribute(
    'aria-label',
    /No valid targets for Iron edge/,
  );
  await expect(page.locator('.grid-cell').nth(11)).toHaveAttribute(
    'aria-label',
    /no valid targets for the selected card/,
  );
  await page.getByRole('button', { name: 'Step I', exact: true }).click();
  await page.locator('.grid-cell[data-x="2"][data-y="1"]').click();
  await expect(strike).not.toHaveClass(/not-useful/);
  await expect(strike).toHaveAccessibleDescription(/1 valid targets/);
  await strike.click();
  await page.locator('.grid-cell[data-x="3"][data-y="1"]').click();
  await expect(page.locator('#plays-badge')).toHaveText('0 plays left');
  // No-play previews remain inspectable; this is not a spectator/turn-disabled hand.
  await expect(
    page.getByRole('button', { name: 'Aegis', exact: true }),
  ).toBeEnabled();
});
test('draft and room choices survive reload and can be reopened after inspecting the board', async ({
  page,
}) => {
  const s = structuredClone(fixtures.draft);
  await restore(page, s);
  await expect(page.locator('[data-draft-card]')).toHaveCount(3);
  await expect(page.locator('[data-draft-card]').first()).toBeFocused();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('#progression-resume').click();
  await expect(page.locator('[data-draft-card]')).toHaveCount(3);
  await page.locator('[data-draft-card]').first().click();
  await expect(page.locator('[data-room-choice]')).toHaveCount(2);
  await page.locator('[data-room-choice="archive"]').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#room-name')).toHaveText(
    LEVELS.find((l) => l.id === 'archive')!.name,
  );
  // The initializer intentionally restores the original pending draft, proving that state can resume.
  await page.reload();
  await expect(page.locator('[data-draft-card]')).toHaveCount(3);
});
test.describe('phone controls', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const width of [320, 390])
    test(`taps and draft choices fit a ${width}px phone`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const s = solo();
      s.enemies = [];
      s.players[0].hand = ['strike', 'step1', 'shield', 'redraw', 'mend'];
      await restore(page, s);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole('button', { name: 'Iron edge', exact: true }).tap();
      await expect(
        page.getByRole('button', { name: 'Iron edge', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Step I', exact: true }).tap();
      await expect(page.locator('.grid-cell.target').first()).toBeVisible();
      await page.locator('.grid-cell.target').first().tap();
      await expect(page.locator('#plays-badge')).toHaveText('1 play left');
      await page.screenshot({
        path: `test-results/phone-${width}.png`,
        fullPage: true,
      });
    });
  test('long draft text and large rooms fit portrait and landscape', async ({
    page,
  }) => {
    const s = structuredClone(fixtures.draft);
    s.draftChoices['local-1'] = ['forge', 'quickshot', 'blink'];
    await page.setViewportSize({ width: 320, height: 568 });
    await restore(page, s);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const dialog = await page.getByRole('dialog').boundingBox();
      expect(dialog!.width).toBeLessThan(viewport.width);
      expect(dialog!.height).toBeLessThan(viewport.height);
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.screenshot({
      path: 'test-results/phone-draft.png',
      fullPage: true,
    });
    await page.locator('[data-draft-card="forge"]').tap();
    await page.locator('[data-room-choice="archive"]').tap();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(
      (await page.locator('.board-wrap').boundingBox())!.width,
    ).toBeLessThan(320);
  });
  test('rectangular rooms keep the canvas and touch grid aligned after rotation', async ({
    page,
  }) => {
    const s = solo();
    s.level = LEVELS.findIndex((level) => level.width !== level.height);
    expect(s.level).toBeGreaterThanOrEqual(0);
    s.enemies = [];
    await restore(page, s);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(async () => {
          const canvas = await page
              .locator('#phaser-board canvas')
              .boundingBox(),
            grid = await page.locator('#accessible-grid').boundingBox();
          return (
            Math.abs(canvas!.width - grid!.width) +
            Math.abs(canvas!.height - grid!.height) +
            Math.abs(canvas!.x - grid!.x) +
            Math.abs(canvas!.y - grid!.y)
          );
        })
        .toBeLessThan(2);
      const board = await page.locator('.board-wrap').boundingBox();
      expect(
        Math.abs(
          board!.width / board!.height -
            LEVELS[s.level].width / LEVELS[s.level].height,
        ),
      ).toBeLessThan(0.01);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
});
