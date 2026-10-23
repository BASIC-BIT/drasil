import { expect, test } from '@playwright/test';
import axe from 'axe-core';

declare global {
  interface Window {
    axe: typeof import('axe-core');
  }
}

const story = '/iframe.html?id=design-foundation-report-inbox--everyday-review&viewMode=story';

test('report queue, evidence, activity and member dates share relative ages', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-06T12:00:00.000Z') });
  await page.goto(story);
  await page.getByRole('heading', { name: 'riverstone', exact: true }).waitFor();
  const checkVisibleDates = async () => {
    const times = page.locator('time:visible');
    expect(await times.count()).toBeGreaterThan(3);
    for (const time of await times.all()) await expect(time).toContainText(/\bago\b/);
  };
  await checkVisibleDates();
  await page.getByRole('tab', { name: 'Evidence 3', exact: true }).click();
  await checkVisibleDates();
  await page.getByRole('tab', { name: 'Activity 1', exact: true }).click();
  await page.getByText('Record details', { exact: true }).click();
  await checkVisibleDates();
  await page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /juniper/ })
    .click();
  const joined = page
    .getByRole('region', { name: 'Member context', exact: true })
    .locator('time')
    .first();
  await expect(joined).toContainText('Jun 4, 2026');
  await expect(joined).toContainText('2 days ago');
  await checkVisibleDates();
});

test('everyday review: read a report, dismiss it and choose the next report', async ({ page }) => {
  await page.goto(story);
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'riverstone', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Evidence 3', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Evidence 3', exact: true })
      .getByText('They sent me a Nitro link and asked me to sign in before it expired.')
  ).toBeVisible();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Evidence 3', exact: true })
      .getByText('nitro-proof.png', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page
    .getByRole('form', { name: 'Dismiss this report?' })
    .getByRole('button', { name: 'Dismiss report', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Report dismissed');
  await expect(page.getByRole('heading', { name: 'riverstone', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss report', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'daybreak', exact: true })).toBeFocused();
  await expect(
    page.getByRole('region', { name: 'Report queue' }).getByRole('button', { name: /riverstone/ })
  ).toHaveCount(0);
  await expect(page.getByText('2 reports in queue', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View receipt', exact: true })).toHaveCount(0);
});

test('mobile selection opens details and back restores the selected queue row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story);
  const row = page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /daybreak/ });
  await row.click();
  await expect(page.getByRole('heading', { name: 'daybreak', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Report queue' })).toBeHidden();
  await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
  await expect(row).toBeFocused();
});

test('search keeps an open report explicit and next follows the filtered queue', async ({
  page,
}) => {
  await page.goto(story);
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('daybreak');
  await expect(
    page.getByText('This report is outside the current search.', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page
    .getByRole('form', { name: 'Dismiss this report?' })
    .getByRole('button', { name: 'Dismiss report', exact: true })
    .click();
  await page.getByRole('button', { name: 'Next report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'daybreak', exact: true })).toBeFocused();
});

test('next report continues after the selected row rather than restarting the queue', async ({
  page,
}) => {
  await page.goto(story);
  await page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /daybreak/ })
    .click();
  await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page
    .getByRole('form', { name: 'Dismiss this report?' })
    .getByRole('button', { name: 'Dismiss report', exact: true })
    .click();
  await page.getByRole('button', { name: 'Next report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'juniper', exact: true })).toBeFocused();
});

test('keyboard review reaches evidence and the next action without returning to the page start', async ({
  page,
}) => {
  await page.goto(story);
  await page.getByRole('tab', { name: 'Review', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Evidence 3', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Evidence 3', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.getByRole('button', { name: 'Dismiss report', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Dismiss this report?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Next report', exact: true })).toBeFocused();
});

for (const width of [390, 1440]) {
  test(`clearing the queue presents one empty state without a stale receipt at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(story);
    await page
      .getByRole('region', { name: 'Report queue' })
      .getByRole('button', { name: /riverstone/ })
      .click();
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
      await page
        .getByRole('form', { name: 'Dismiss this report?' })
        .getByRole('button', { name: 'Dismiss report', exact: true })
        .click();
      await expect(page.getByRole('status')).toContainText('Report dismissed');
      await page.getByRole('tab', { name: 'Activity 2', exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: 'Activity 2' })).toContainText(
        'Report dismissed'
      );
      await page
        .getByRole('button', { name: index < 2 ? 'Next report' : 'Back to queue', exact: true })
        .click();
    }
    await expect(page.getByRole('heading', { name: 'Inbox clear', exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Inbox clear', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View receipt', exact: true })).toHaveCount(0);
    await expect(page.getByText('juniper · Report dismissed', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Selected report' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeFocused();
    await page.getByRole('searchbox', { name: 'Search reports' }).fill('missing');
    await expect(
      page.getByRole('heading', { name: 'No matching reports', exact: true })
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inbox clear', exact: true })).toHaveCount(1);
  });
}

test('returning to the mobile inbox after dismissal removes the closed row and receipt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story);
  const queue = page.getByRole('region', { name: 'Report queue' });
  await queue.getByRole('button', { name: /riverstone/ }).click();
  await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page
    .getByRole('form', { name: 'Dismiss this report?' })
    .getByRole('button', { name: 'Dismiss report', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Report dismissed');
  await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
  await expect(queue.getByRole('button', { name: /riverstone/ })).toHaveCount(0);
  await expect(queue.getByRole('button', { name: /daybreak/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View receipt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeFocused();
});

test('case confirmation restores focus on cancel and moves to the queued receipt on submit', async ({
  page,
}) => {
  await page.goto(story);
  const open = page.getByRole('button', { name: 'Open case', exact: true });
  await open.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(open).toBeFocused();
  await open.click();
  await page.locator('form').getByRole('button', { name: 'Open case', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Case request queued');
  await expect(page.getByRole('status')).toBeFocused();
});

for (const theme of ['everyday-review', 'light']) {
  for (const width of [320, 1440]) {
    test(`report inbox accessibility and reflow: ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/iframe.html?id=design-foundation-report-inbox--${theme}&viewMode=story`);
      await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: axe.source });
      const audit = async (): Promise<void> => {
        const violations = await page.evaluate(async () => {
          const root = document.getElementById('storybook-root');
          if (!root) throw new Error('Storybook root is missing');
          const result = await window.axe.run(root, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
          });
          return result.violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            targets: nodes.map(({ target }) => target),
          }));
        });
        expect(violations).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
          )
        ).toBe(true);
      };
      await audit();
      if (width < 1100) {
        await page
          .getByRole('region', { name: 'Report queue' })
          .getByRole('button', { name: /riverstone/ })
          .click();
      }
      await page.getByRole('tab', { name: 'Evidence 3', exact: true }).click();
      await audit();
      await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
      await audit();
      await page
        .getByRole('form', { name: 'Dismiss this report?' })
        .getByRole('button', { name: 'Dismiss report', exact: true })
        .click();
      await expect(page.getByRole('status')).toContainText('Report dismissed');
      await audit();
    });
  }
}

test('dismissal requires confirmation and cancelling keeps the report open', async ({ page }) => {
  await page.goto(story);
  const dismiss = page.getByRole('button', { name: 'Dismiss report', exact: true });
  await dismiss.click();
  const confirmation = page.getByRole('form', { name: 'Dismiss this report?' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('heading', { name: 'Dismiss this report?' })).toBeFocused();
  await expect(confirmation).toContainText(
    'Close this report without taking action against the member.'
  );
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByText('3 reports in queue', { exact: true })).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(dismiss).toBeFocused();
  await expect(page.getByRole('status')).toHaveCount(0);
  await dismiss.click();
  await confirmation.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Report dismissed');
  await expect(page.getByRole('button', { name: 'Next report', exact: true })).toBeFocused();
  await expect(page.getByText('2 reports in queue', { exact: true })).toBeVisible();
});

for (const scenario of [
  {
    action: 'Mark handled',
    heading: 'Mark this report as handled?',
    effect: 'Close this report as handled based on action already taken.',
    receipt: 'Report marked handled',
  },
  {
    action: 'Mark false positive',
    heading: 'Mark this report as a false positive?',
    effect: 'Mark this report as a false positive and close it.',
    receipt: 'Marked as false positive',
  },
]) {
  test(`${scenario.action} requires confirmation and cancellation preserves the report`, async ({
    page,
  }) => {
    await page.goto(story);
    await page
      .getByRole('region', { name: 'Report queue' })
      .getByRole('button', { name: /daybreak/ })
      .click();
    const action = page.getByRole('button', { name: scenario.action, exact: true });
    await action.click();
    const confirmation = page.getByRole('form', { name: scenario.heading, exact: true });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('heading', { name: scenario.heading, exact: true })
    ).toBeFocused();
    await expect(confirmation).toContainText(scenario.effect);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByText('3 reports in queue', { exact: true })).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(action).toBeFocused();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    await action.click();
    await confirmation.getByRole('button', { name: scenario.action, exact: true }).click();
    await expect(page.getByRole('status')).toContainText(scenario.receipt);
    await expect(page.getByRole('button', { name: 'Next report', exact: true })).toBeFocused();
    await expect(page.getByText('2 reports in queue', { exact: true })).toBeVisible();
  });
}

for (const width of [390, 1440]) {
  test(`pending case requests remain visible in the queue and Activity at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(story);
    const queue = page.getByRole('region', { name: 'Report queue' });
    await queue.getByRole('button', { name: /riverstone/ }).click();
    await page.getByRole('button', { name: 'Open case', exact: true }).click();
    await page.getByRole('form').getByRole('button', { name: 'Open case', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Case request queued');
    if (width < 1100) {
      await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
    } else {
      await queue.getByRole('button', { name: /daybreak/ }).click();
    }
    const pending = queue.getByRole('button', { name: /riverstone/ });
    await expect(pending).toContainText('Case request queued');
    await pending.click();
    await page.getByRole('tab', { name: 'Activity 2', exact: true }).click();
    const activity = page.getByRole('tabpanel', { name: 'Activity 2', exact: true });
    await expect(activity).toContainText('Report submitted');
    await expect(activity).toContainText('Case request queued');
    await expect(page.getByRole('button', { name: 'Open case', exact: true })).toBeDisabled();
  });
}

for (const width of [320, 390]) {
  for (const scenario of [
    { action: 'Open case', member: 'riverstone', report: 'report-1' },
    { action: 'Dismiss report', member: 'riverstone', report: 'report-1' },
    { action: 'Mark false positive', member: 'riverstone', report: 'report-1' },
    { action: 'Mark handled', member: 'daybreak', report: 'report-2' },
  ]) {
    test(`confirmation identifies its target on mobile: ${scenario.action} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(story);
      await page
        .getByRole('region', { name: 'Report queue' })
        .getByRole('button', { name: new RegExp(scenario.member) })
        .click();
      await page.getByRole('tab', { name: /^Evidence/ }).click();
      await page.getByRole('button', { name: scenario.action, exact: true }).click();
      const form = page.getByRole('form');
      await expect(form.getByText(scenario.member, { exact: true })).toBeInViewport();
      await expect(form.getByText(scenario.report, { exact: true })).toBeInViewport();
      await expect(form.getByRole('heading')).toBeFocused();
      await expect(form.getByRole('heading')).toHaveAttribute('aria-describedby', /\S+/);
      await form.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('button', { name: scenario.action, exact: true })).toBeFocused();
    });
  }
}

test('search shows match counts without changing the total queue count', async ({ page }) => {
  await page.goto(story);
  const search = page.getByRole('searchbox', { name: 'Search reports' });
  const queue = page.getByRole('region', { name: 'Report queue' });
  await search.fill('daybreak');
  await expect(page.getByText('3 reports in queue', { exact: true })).toBeVisible();
  await expect(queue.getByText('1 match', { exact: true })).toBeVisible();
  await search.fill('missing');
  await expect(page.getByText('3 reports in queue', { exact: true })).toBeVisible();
  await expect(queue.getByText('0 matches', { exact: true })).toBeVisible();
  await expect(
    page.getByText('This report is outside the current search.', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByText('3 reports in queue', { exact: true })).toBeVisible();
  await search.fill('daybreak');
  await page.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page.getByRole('form').getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await expect(page.getByText('2 reports in queue', { exact: true })).toBeVisible();
  await expect(queue.getByText('1 match', { exact: true })).toBeVisible();
});

test('a narrow phone shows the whole confirmation when opening it from Review', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(story);
  await page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /daybreak/ })
    .click();
  await page.getByRole('button', { name: 'Mark handled', exact: true }).click();
  const form = page.getByRole('form');
  await expect(form.getByText('daybreak', { exact: true })).toBeInViewport();
  await expect(form.getByText('report-2', { exact: true })).toBeInViewport();
  await expect(form.getByRole('button', { name: 'Mark handled', exact: true })).toBeInViewport();
  await expect(form.getByRole('heading')).toBeFocused();
});

test('mobile workspace menu exposes destinations and closes with Escape or an outside click', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story);
  const menu = page.getByRole('button', { name: 'Community workspace menu', exact: true });
  await menu.click();
  const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const root = document.querySelector('[data-foundation-theme]');
    if (!root) throw new Error('Missing foundation root');
    return (await window.axe.run(root)).violations;
  });
  expect(violations).toEqual([]);
  for (const destination of ['Cases', 'Reports', 'History', 'Setup', 'Operations']) {
    await expect(navigation.getByRole('link', { name: destination, exact: true })).toHaveAttribute(
      'href',
      `/admin/guild/guild-1/${destination.toLowerCase()}`
    );
  }
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: 'Inbox', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.getByRole('link', { name: 'Drasil', exact: true }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('mobile workspace Inbox preserves search and the selected evidence tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story);
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('riverstone');
  const row = page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /riverstone/ });
  await row.click();
  await page.getByRole('tab', { name: 'Evidence 3', exact: true }).click();
  await page.getByRole('button', { name: 'Community workspace menu', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('link', { name: 'Inbox', exact: true })
    .click();
  await expect(row).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Search reports' })).toHaveValue('riverstone');
  await row.click();
  await expect(page.getByRole('tab', { name: 'Evidence 3', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('tabpanel', { name: 'Evidence 3', exact: true })).toBeVisible();
});

test('Review includes the statement and attachment without requiring an Evidence tab change', async ({
  page,
}) => {
  await page.goto(story);
  const review = page.getByRole('tabpanel', { name: 'Review', exact: true });
  await expect(
    review.getByText('They sent me a Nitro link and asked me to sign in before it expired.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(review.getByText('nitro-proof.png', { exact: true })).toBeVisible();
  await expect(review.getByRole('link', { name: /nitro-proof\.png.*in a new tab/ })).toBeVisible();
  await expect(
    review.getByRole('heading', { name: 'Reporter identification', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Full evidence record', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Evidence 3', exact: true })
      .getByRole('heading', { name: 'Reporter identification', exact: true })
  ).toBeVisible();
});

test('decision context promotes member identity and renders only supplied profile facts', async ({
  page,
}) => {
  await page.goto(story);
  const context = page.getByRole('region', { name: 'Member context', exact: true });
  await expect(context.getByText('user-300', { exact: true })).toBeVisible();
  await expect(context.getByRole('link', { name: 'Member history', exact: true })).toHaveAttribute(
    'href',
    '/admin/guild/guild-1/members/user-300'
  );
  await expect(context.getByText('Case role', { exact: true })).toHaveCount(0);
  await expect(context.getByText('No history', { exact: true })).toHaveCount(0);
  await page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /juniper/ })
    .click();
  await expect(context.getByText('user-500', { exact: true })).toBeVisible();
  await expect(context.getByText('In server', { exact: true })).toBeVisible();
  await expect(context.getByText('Case role', { exact: true })).toBeVisible();
  await expect(context.getByText('Inactive', { exact: true })).toBeVisible();
  await expect(context.getByText('Marked false positive', { exact: true })).toBeVisible();
  await expect(context.getByRole('link', { name: 'Member history', exact: true })).toHaveAttribute(
    'href',
    '/admin/guild/guild-1/members/user-500'
  );
  await page
    .getByRole('region', { name: 'Report queue' })
    .getByRole('button', { name: /daybreak/ })
    .click();
  await expect(context.getByRole('link', { name: 'Linked case', exact: true })).toHaveAttribute(
    'href',
    '/admin/guild/guild-1/cases/case-report-2'
  );
  await expect(context.getByText('Case role', { exact: true })).toHaveCount(0);
});

test('choosing Inbox from the workspace menu preserves a visible keyboard focus when already in the queue', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story);
  await page.getByRole('button', { name: 'Community workspace menu', exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(
    page
      .getByRole('navigation', { name: 'Workspace', exact: true })
      .getByRole('link', { name: 'Inbox', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Report queue' }).getByRole('button', { name: /riverstone/ })
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Community workspace menu', exact: true })
  ).toHaveAttribute('aria-expanded', 'false');
});
