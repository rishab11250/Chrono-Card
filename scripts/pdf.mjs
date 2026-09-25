import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_BUNDLED_CHROMIUM
    ? undefined
    : process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.goto(new URL('../docs/submission.html', import.meta.url).href, {
    waitUntil: 'networkidle',
  });
  const overflowingPages = await page.evaluate(() =>
    [...document.querySelectorAll('.page')].flatMap((sheet, index) => {
      const footer = sheet.querySelector('.footer').getBoundingClientRect();
      return [...sheet.children].some(
        (child) =>
          !child.classList.contains('footer') &&
          child.getBoundingClientRect().bottom > footer.top - 5,
      )
        ? [index + 1]
        : [];
    }),
  );
  if (overflowingPages.length)
    throw new Error(
      `Content overlaps the footer on page(s): ${overflowingPages.join(', ')}`,
    );
  await page.pdf({
    path: fileURLToPath(
      new URL('../docs/chrono-card-submission.pdf', import.meta.url),
    ),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  console.log('Created docs/chrono-card-submission.pdf');
} finally {
  await browser.close();
}
