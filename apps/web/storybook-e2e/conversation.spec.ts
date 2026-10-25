import { expect, test } from '@playwright/test';
import axe from 'axe-core';
const story = '/iframe.html?id=workspace-channel-conversation--available&viewMode=story';
for (const width of [320, 390, 1440]) {
  test(`conversation round trip, paging, source and attachments at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(story);
    const open = page.getByRole('button', { name: 'View conversation' });
    await open.click();
    const reader = page.getByRole('region', { name: 'Channel conversation' });
    await expect(reader.getByText('Current source text', { exact: true })).toBeVisible();
    await expect(page.getByText('Complete saved quotation', { exact: true })).toBeVisible();
    await expect(
      reader
        .locator('[data-source="true"]')
        .getByText('Actual author (100000000000000009)', { exact: true })
    ).toBeVisible();
    await expect(reader.getByText(/50 messages loaded/)).toBeVisible();
    const earlier = reader.getByRole('button', { name: 'Load earlier' });
    await earlier.focus();
    await page.keyboard.press('Enter');
    await expect(reader.getByText(/100 messages loaded/)).toBeVisible();
    await expect(earlier).toBeFocused();
    const source = reader.locator('[data-source="true"]');
    await source.scrollIntoViewIfNeeded();
    const before = await source.boundingBox();
    await earlier.evaluate((button: HTMLButtonElement) => button.click());
    await expect(reader.getByText(/150 messages loaded/)).toBeVisible();
    const after = await source.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(3);
    const later = reader.getByRole('button', { name: 'Load later' });
    await later.click();
    await expect(reader.getByText(/200 messages loaded/)).toBeVisible();
    await expect(later).toBeFocused();
    await expect(reader.getByText('200-message limit reached. Continue in Discord.')).toBeVisible();
    await expect(earlier).toHaveAttribute('aria-disabled', 'true');
    await context.route('https://cdn.discordapp.com/attachments/example/proof.png', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Proof attachment</title>' })
    );
    const attachment = reader.getByRole('link', { name: 'proof.png in a new tab' });
    await attachment.focus();
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://cdn.discordapp.com/attachments/example/proof.png');
    await popup.close();
    await expect(
      reader.getByRole('link', { name: 'Continue in Discord in a new tab' })
    ).toHaveAttribute('href', /discord.com\/channels/);
    await page.screenshot({
      path: testInfo.outputPath(`conversation-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.evaluate(axe.source);
    const audit = await page.evaluate(
      async () =>
        await (window as unknown as { axe: typeof axe }).axe.run(document.body, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })
    );
    expect(audit.violations).toEqual([]);
    await reader.getByRole('button', { name: 'Back to source' }).click();
    await expect(open).toBeFocused();
    await expect(page.getByText('Complete saved quotation', { exact: true })).toBeVisible();
  });
  test(`source deletion and denied access preserve saved quotation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(story.replace('--available', '--deleted-source'));
    await page.getByRole('button', { name: 'View conversation' }).click();
    await expect(
      page.getByText('Source message is no longer available in this page.')
    ).toBeVisible();
    await expect(page.getByText('Complete saved quotation', { exact: true })).toBeVisible();
    await expect(page.getByText(/50 messages loaded/)).toBeVisible();
    await page.goto(story.replace('--available', '--denied-channel'));
    await page.getByRole('button', { name: 'View conversation' }).click();
    await expect(page.getByText('You do not have access to this conversation.')).toBeVisible();
    await expect(page.getByText('Complete saved quotation', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Continue in Discord in a new tab' })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`conversation-denied-${width}.png`),
      fullPage: true,
    });
  });
}

for (const state of ['loaded', 'pending']) {
  for (const identity of ['channel', 'message']) {
    test(`resolved source replacement resets ${state} context when ${identity} changes`, async ({
      page,
    }) => {
      await page.goto(story.replace('--available', `--replace-${state}-${identity}`));
      const reader = page.getByRole('region', { name: 'Channel conversation' });
      if (state === 'loaded')
        await expect(reader.getByText('Old source text', { exact: true })).toBeVisible();
      else await expect(reader.getByText('Loading conversation…')).toBeVisible();
      await page.getByRole('button', { name: 'Replace resolved source' }).click();
      await expect(reader.getByText('Old source text', { exact: true })).toHaveCount(0);
      await expect(reader.locator('[data-source="true"]')).toHaveText(/Replacement source text/);
      await expect(reader.getByText(/1 messages loaded/)).toBeVisible();
      await expect(
        reader.getByRole('heading', { name: 'Conversation · #replacement' })
      ).toBeVisible();
      const channel = identity === 'channel' ? '100000000000000003' : '100000000000000002';
      const message = identity === 'message' ? '100000000000000126' : '100000000000000125';
      await expect(
        reader.getByRole('link', { name: 'Continue in Discord in a new tab' })
      ).toHaveAttribute(
        'href',
        `https://discord.com/channels/100000000000000001/${channel}/${message}`
      );
      if (state === 'pending') {
        await expect(page.getByText('Old request aborted: true', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Release old response' }).click();
        await expect(page.getByText('Old response released: true', { exact: true })).toBeVisible();
      }
      await reader.getByRole('button', { name: 'Load later' }).click();
      await expect(
        page.getByText(`Last replacement page: after:${message}`, { exact: true })
      ).toBeVisible();
      await expect(reader.getByText(/2 messages loaded/)).toBeVisible();
      await expect(reader.locator('article')).toHaveCount(2);
      await expect(reader.getByText('Replacement source text', { exact: true })).toBeVisible();
      await expect(reader.getByText('Replacement later message', { exact: true })).toBeVisible();
      await expect(reader.getByText('Old source text', { exact: true })).toHaveCount(0);
      await expect(
        reader.getByRole('heading', { name: 'Conversation · #replacement' })
      ).toBeVisible();
    });
  }
}
