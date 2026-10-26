import { expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Inspect the actual page in both themes and widths; retain images only on request. */
export async function inspectEntryPresentation(page: Page, name: string): Promise<void> {
  const original = page.viewportSize();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' });
      await page.evaluate((value) => {
        localStorage.removeItem('drasil-theme');
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(
        page.getByRole('link', { name: 'Drasil', exact: true }).filter({ visible: true })
      ).toHaveCount(1);
      await expect(page.locator('[data-foundation-theme]')).toHaveCount(1);
      await expect(page.locator('[data-foundation-theme]')).toHaveCSS('color-scheme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name} has horizontal overflow at ${width}px in ${theme}`
      ).toBe(true);
      const directory = process.env.DRASIL_ENTRY_EVIDENCE_DIR;
      if (directory) {
        await mkdir(directory, { recursive: true });
        await page.screenshot({
          path: path.join(directory, `${name}-${width}-${theme}.png`),
          fullPage: true,
          caret: 'initial',
        });
      }
    }
  }
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
  if (original) await page.setViewportSize(original);
}
