import { test, expect } from '@playwright/test';
test('corrupt local saves recover to a usable board and malformed ghost storage stays harmless', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'chrono-local-v1',
      JSON.stringify({
        mode: 'solo',
        seed: 42,
        rng: 42,
        level: 0,
        active: 100,
        players: [{}],
      }),
    );
    localStorage.setItem('chrono-achievements', 'null');
    localStorage.setItem('chrono-ghosts-v1', '{}');
  });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(5);
  await expect(page.locator('#phaser-board canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Ghost ally', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText("Ada's Echo");
  expect(errors).toEqual([]);
});
test('blocked browser storage still permits live online rooms', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
    Storage.prototype.removeItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play with friends' }).click();
  await page.getByLabel('Your name').fill('NoStorage');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await expect(page.locator('.room-code strong')).toBeVisible();
});
test('simultaneous guest plans and submits its own turn, including after refresh', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const host = await a.newPage(),
      guest = await b.newPage();
    await host.goto('/');
    await host.getByRole('button', { name: 'Play with friends' }).click();
    await host.getByLabel('Your name').fill('PlannerA');
    await host.getByLabel('Turn order').selectOption('simultaneous');
    await host.getByRole('button', { name: 'Create a room' }).click();
    const code = await host.locator('.room-code strong').textContent();
    await guest.goto(`/?room=${code}`);
    await guest.getByLabel('Your name').fill('PlannerB');
    await guest.getByRole('button', { name: 'Join expedition' }).click();
    await expect(host.locator('.lobby-members')).toContainText('PlannerB');
    await host.getByRole('button', { name: 'Begin expedition' }).click();
    await expect(guest.locator('#end-turn')).toHaveText('Submit turn ↗');
    await expect(guest.locator('#end-turn')).toBeEnabled();
    await expect(guest.locator('#hand-title')).toContainText('PlannerB');
    await guest.locator('.card.move:not(.not-useful)').first().click();
    await guest.locator('.grid-cell.target').first().click();
    await expect(guest.locator('#selection-hint')).toContainText(
      '1 cards planned',
    );
    await expect(guest.locator('#plays-badge')).toHaveText('1 play left');
    await expect(host.locator('#round-label')).toHaveText('ROUND 01');
    await guest.locator('#reset-plan').click();
    await expect(guest.locator('#plays-badge')).toHaveText('2 plays left');
    await expect(guest.locator('#selection-hint')).toContainText(
      '0 cards planned',
    );
    await guest.locator('.card.move:not(.not-useful)').first().click();
    await guest.locator('.grid-cell.target').first().click();
    await guest.locator('#end-turn').click();
    await expect(guest.locator('#end-turn')).toHaveText('Turn submitted');
    await expect(guest.locator('#end-turn')).toBeDisabled();
    await guest.reload();
    await expect(guest.locator('#end-turn')).toHaveText('Turn submitted');
    await host.locator('#end-turn').click();
    await expect(guest.locator('#round-label')).toHaveText('ROUND 02');
    await expect(guest.locator('#end-turn')).toBeEnabled();
    await expect(host.locator('#round-label')).toHaveText('ROUND 02');
  } finally {
    await a.close();
    await b.close();
  }
});
