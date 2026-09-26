import { expect, test, type Page } from '@playwright/test';

async function createRoom(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Play with friends/ }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create a room' }).click();
  await expect(page.locator('.room-code strong')).toBeVisible();
  return (await page.locator('.room-code strong').textContent())!;
}
test('canvas updates the player immediately and matches the restored board without needing refresh', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const canvas = page.locator('#phaser-board canvas');
  const capture = () =>
    canvas.screenshot({
      style: '#accessible-grid { visibility: hidden !important; }',
    });
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await capture();
  await page.locator('.card.move:not(.not-useful)').first().click();
  await page.locator('.grid-cell.target').first().click();
  await expect(page.locator('#plays-badge')).toHaveText('1 play left');
  await expect.poll(async () => (await capture()).equals(before)).toBe(false);
  const moved = await capture();
  // Reconstructing the same saved state must not be needed to correct sprite positions.
  await page.reload();
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(async () => (await capture()).equals(moved)).toBe(true);
});
test('solo plays a movement card, ends turns, restores a run, and opens help', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#phaser-board canvas')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(5);
  const first = page.locator('.card.move').first();
  await first.click();
  await expect(page.locator('.grid-cell.target').first()).toBeVisible();
  await page.locator('.grid-cell.target').first().click();
  await expect(page.locator('#plays-badge')).toHaveText('1 play left');
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('#round-label')).toHaveText('ROUND 02');
  await page.reload();
  await expect(page.locator('#round-label')).toHaveText('ROUND 02');
  await page.getByRole('button', { name: /How to play/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Make my first move' }).click();
  expect(errors).toEqual([]);
});
test('couch co-op alternates turns before enemies act', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Couch co-op/ }).click();
  await expect(page.locator('.party-member')).toHaveCount(2);
  await expect(page.locator('#turn-label')).toHaveText('YOUR TURN');
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('#turn-label')).toHaveText("EXPLORER 2'S TURN");
  await expect(page.locator('#round-label')).toHaveText('ROUND 01');
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('#round-label')).toHaveText('ROUND 02');
});
test('online host, guest, spectator, and refresh stay synchronized', async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext({ reducedMotion: 'reduce' }),
    browser.newContext({ reducedMotion: 'reduce' }),
    browser.newContext({ reducedMotion: 'reduce' }),
  ]);
  try {
    const [host, guest, spectator] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const code = await createRoom(host, 'Ada');
    await guest.goto(`/?room=${code}`);
    await guest.getByLabel('Your name').fill('Bram');
    await guest.getByRole('button', { name: 'Join expedition' }).click();
    await expect(host.locator('.lobby-members')).toContainText('Bram');
    await host.getByRole('button', { name: 'Begin expedition' }).click();
    await expect(host.getByRole('dialog')).not.toBeVisible();
    await expect(guest.getByRole('dialog')).not.toBeVisible();
    await expect(host.locator('#turn-label')).toHaveText("ADA'S TURN");
    await expect(
      guest.getByRole('button', { name: 'End turn' }),
    ).toBeDisabled();
    await spectator.goto(`/?watch=${code}`);
    await spectator
      .getByRole('button', { name: 'Watch this expedition' })
      .click();
    await expect(spectator.locator('#turn-label')).toHaveText('SPECTATING');
    await expect(
      spectator.getByRole('button', { name: 'End turn' }),
    ).toBeDisabled();
    const remoteBoards = [guest, spectator].map((page) =>
      page.locator('#phaser-board canvas'),
    );
    for (const page of [guest, spectator])
      await page.evaluate(() => document.fonts.ready);
    const beforeMove = await Promise.all(
      remoteBoards.map((canvas) => canvas.screenshot()),
    );
    await host.locator('.card.move:not(.not-useful)').first().click();
    await host.locator('.grid-cell.target').first().click();
    await expect(host.locator('#plays-badge')).toHaveText('1 play left');
    for (const [index, canvas] of remoteBoards.entries()) {
      await expect
        .poll(async () => (await canvas.screenshot()).equals(beforeMove[index]))
        .toBe(false);
    }
    await host.getByRole('button', { name: 'End turn' }).click();
    await expect(guest.getByRole('button', { name: 'End turn' })).toBeEnabled();
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'End turn' })).toBeEnabled();
    await expect(guest.locator('#turn-label')).toHaveText("BRAM'S TURN");
    await guest.getByRole('button', { name: 'End turn' }).click();
    await expect(host.locator('#round-label')).toHaveText('ROUND 02');
    await expect(spectator.locator('#round-label')).toHaveText('ROUND 02');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
test('daily mode starts and presents its leaderboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Daily challenge/ }).click();
  await expect(page.locator('#leaderboard')).not.toContainText('Loading');
  await page.getByLabel('Your name').fill('Daily explorer');
  await page.getByRole('button', { name: 'Take the daily challenge' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#mode-label')).toHaveText('DAILY CHALLENGE');
  await expect(page.getByRole('button', { name: 'End turn' })).toBeEnabled();
});
test('mobile board fits viewport and cards scroll without widening the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#phaser-board canvas')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const board = await page.locator('.board-wrap').boundingBox();
  expect(board!.width).toBeLessThan(390);
  expect(Math.abs(board!.width - board!.height)).toBeLessThan(1);
  await page.locator('.card').first().click();
  await expect(page.locator('.grid-cell.target').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('keyboard users can select cards and navigate tile controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('1');
  await expect(page.locator('.card').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('.grid-cell').nth(11).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.grid-cell').nth(12)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card.selected')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});
