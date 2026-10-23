import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const story = '/iframe.html?id=design-foundation-case-workspace--everyday-case&viewMode=story';

test('case evidence, checks, activity and record dates include relative ages', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-06T12:00:00.000Z') });
  await page.goto(story.replace('everyday-case', 'busy-case'));
  await page.getByRole('heading', { name: 'fieldnote', exact: true }).waitFor();
  await page.getByText('Saved surrounding messages', { exact: false }).first().click();
  await page.getByText('Earlier checks', { exact: false }).first().click();
  await page.getByText('Recorded activity', { exact: true }).click();
  await page.getByText('Record details', { exact: true }).click();
  const times = page.locator('time:visible');
  expect(await times.count()).toBeGreaterThan(10);
  for (const time of await times.all()) {
    await expect(time).toContainText(/\bago\b/);
    await expect(time).toHaveAttribute('datetime', /2026-/);
  }
});

test('case opening time includes an age that updates while the case stays open', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-06-02T12:12:00.000Z') });
  await page.goto(story);
  const opened = page.getByText(/^Opened /);
  await expect(opened).toContainText('2 minutes ago');
  await expect(opened.locator('time')).toHaveAttribute('datetime', '2026-06-02T12:10:00.000Z');
  await expect(opened).toContainText('Jun 2, 12:10 PM UTC');
  await page.clock.fastForward(60_000);
  await expect(opened).toContainText('3 minutes ago');
  await page.clock.fastForward(58 * 60_000);
  await expect(opened).toContainText('1 hour ago');
});

test('the screenshot item is a single keyboard-accessible attachment link', async ({
  page,
  context,
}) => {
  const url = 'https://cdn.discordapp.com/attachments/fixture/nitro-proof.png';
  await context.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Screenshot attachment</title>' })
  );
  await page.goto(story);
  const item = page.getByRole('link', { name: /nitro-proof\.png.*in a new tab/ });
  await expect(item.getByRole('heading', { name: 'Screenshot', exact: true })).toBeVisible();
  await expect(item).toHaveAttribute('href', url);
  await expect(page.getByRole('link', { name: /Open attachment/ })).toHaveCount(0);
  await item.focus();
  const opened = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await opened;
  await expect(popup).toHaveURL(url);
  await popup.close();
  await expect(page.getByRole('heading', { name: 'riverstone', exact: true })).toBeVisible();
});

test('saved representations of one Discord message retain both texts under one source link', async ({
  page,
}) => {
  await page.goto(story.replace('everyday-case', 'busy-case'));
  const group = page.getByRole('region', { name: 'Records from one source message', exact: true });
  await expect(group).toContainText('2 saved records');
  await expect(
    group.getByText(
      'They asked me to claim a prize through a short link and said it expires today.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    group.getByText(
      'free rewards for early members, claim here before it expires: https://short.example/prize',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    group.getByRole('link', { name: 'View in Discord in a new tab', exact: true })
  ).toHaveCount(1);
});

test('expanded evidence retains a visible path to decisions and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story.replace('everyday-case', 'busy-case'));
  await page.getByText('Saved surrounding messages', { exact: false }).first().click();
  await page
    .getByText('The screenshots are attached to the report now.', { exact: true })
    .scrollIntoViewIfNeeded();
  const navigation = page.getByRole('navigation', { name: 'Case sections', exact: true });
  const jump = navigation.getByRole('link', { name: 'Decision', exact: true });
  await expect(jump).toBeInViewport();
  await jump.click();
  await expect(page.getByRole('heading', { name: 'Decision', exact: true })).toBeFocused();
  await navigation.getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evidence', exact: true })).toBeFocused();
  await expect(
    page.getByText(
      'They asked me to claim a prize through a short link and said it expires today.',
      { exact: true }
    )
  ).toBeInViewport();
});

test('ordinary case keeps submitted evidence and current member context together', async ({
  page,
}) => {
  await page.goto(story);
  await expect(page.getByRole('heading', { name: 'riverstone', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Member context' })).toContainText(
    'Case role active'
  );
  await expect(
    page.getByText('They sent me a Nitro link and asked me to sign in before it expired.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /nitro-proof\.png.*in a new tab/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Case thread in a new tab' })).toHaveAttribute(
    'href',
    /case-thread-300/
  );
  await expect(
    page
      .getByRole('navigation', { name: 'Workspace', exact: true })
      .getByRole('link', { name: 'Cases', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Drasil checks', { exact: true })).toHaveCount(0);
});

for (const label of ['Verify member', 'Close case', 'Kick member', 'Ban member']) {
  test(`${label} requires a contextual confirmation and cancel preserves the case`, async ({
    page,
  }) => {
    await page.goto(story);
    const action = page.getByRole('button', { name: label, exact: true });
    await action.click();
    const confirmation = page.getByRole('form', { name: `${label}?`, exact: true });
    await expect(confirmation.getByRole('heading')).toBeFocused();
    await expect(confirmation).toContainText('riverstone');
    await expect(confirmation).toContainText('user-300');
    await expect(confirmation).toContainText('case-report-1');
    if (label === 'Verify member' || label === 'Close case') {
      await expect(confirmation).toContainText('all open cases for this member in this server');
      await expect(confirmation).toContainText('eligible quarantined roles');
    }
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(action).toBeFocused();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

test('queued ban remains a request while evidence and recorded member state stay available', async ({
  page,
}) => {
  await page.goto(story);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const confirmation = page.getByRole('form', { name: 'Ban member?', exact: true });
  await confirmation
    .getByRole('textbox', { name: 'Reason', exact: true })
    .fill('Unsolicited credential link');
  await confirmation.getByRole('button', { name: 'Ban member', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Ban request queued');
  await expect(page.getByRole('region', { name: 'Member context' })).toContainText('In server');
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: /nitro-proof\.png.*in a new tab/ })).toBeVisible();
  await page.getByText('Recorded activity', { exact: false }).first().click();
  await expect(page.getByRole('region', { name: 'Case activity' })).toContainText(
    'Ban request queued'
  );
  await expect(page.getByRole('region', { name: 'Case activity' })).not.toContainText(
    'Member banned'
  );
});

test('a completed request does not invent a refreshed member outcome', async ({ page }) => {
  await page.goto(story.replace('everyday-case', 'completed-request'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await page
    .getByRole('form', { name: 'Ban member?', exact: true })
    .getByRole('button', { name: 'Ban member', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Ban request completed');
  const context = page.getByRole('region', { name: 'Member context' });
  await expect(context).toContainText('Member state from last case load');
  await expect(context).toContainText('In server');
  await expect(context).not.toContainText('Banned');
});

test('busy case separates saved excerpts, submitted evidence, checks and recorded outcomes', async ({
  page,
}) => {
  await page.goto(story.replace('everyday-case', 'busy-case'));
  await expect(page.getByRole('heading', { name: 'fieldnote', exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'They asked me to claim a prize through a short link and said it expires today.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Drasil checks', exact: true })).toBeVisible();
  await expect(
    page.getByText('Repeated prize language and a short-link ask in a new account context.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText('Source message excerpt', { exact: true })).toBeVisible();
  const saved = page.getByText('Saved surrounding messages', { exact: false }).first();
  await saved.click();
  await expect(
    page.getByText('The screenshots are attached to the report now.', { exact: true })
  ).toBeVisible();
  await page.getByText('Earlier checks', { exact: false }).first().click();
  await expect(
    page.getByText('Message matched scam-keyword heuristics.', { exact: true })
  ).toBeVisible();
  await page.getByText('Recorded activity', { exact: false }).first().click();
  await expect(page.getByRole('region', { name: 'Case activity' })).toContainText('Restricted');
  await expect(page.getByRole('region', { name: 'Case activity' })).toContainText('bot-1');
});

for (const width of [320, 1440])
  for (const theme of ['everyday-case', 'light']) {
    test(`case accessibility, reflow and confirmation at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(story.replace('everyday-case', theme));
      await expect(page.getByRole('heading', { name: 'riverstone', exact: true })).toBeVisible();
      await page.addScriptTag({ content: axe.source });
      const audit = async () => {
        const result = await page.evaluate(async () => {
          const root = document.querySelector('[data-foundation-theme]');
          if (!root) throw new Error('Missing foundation root');
          return {
            violations: (await window.axe.run(root)).violations,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        });
        expect(result.violations).toEqual([]);
        expect(result.overflow).toBe(false);
      };
      await audit();
      await page.getByRole('button', { name: 'Verify member', exact: true }).click();
      const form = page.getByRole('form', { name: 'Verify member?', exact: true });
      await expect(
        form.getByRole('button', { name: 'Verify member', exact: true })
      ).toBeInViewport();
      await expect(form.getByRole('heading')).toBeFocused();
      await audit();
    });
  }

test('an asynchronous request result preserves focus when the moderator resumes reading', async ({
  page,
}) => {
  await page.goto(story.replace('everyday-case', 'delayed-request'));
  await page.getByRole('button', { name: 'Verify member', exact: true }).click();
  await page
    .getByRole('form', { name: 'Verify member?', exact: true })
    .getByRole('button', { name: 'Verify member', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Submitting verification request');
  const records = page.getByText('Record details', { exact: true });
  await records.click();
  await expect(records).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Verification request queued');
  await expect(records).toBeFocused();
});
