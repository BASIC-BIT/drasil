import { expect, test } from '@playwright/test';
import axe from 'axe-core';
const story = '/iframe.html?id=moderation-workspace-inbox-controller--mixed&viewMode=story';
const observed = 'detection:det-observed-1';

test('keyboard selection opens a detail and slow A cannot replace fast B', async ({ page }) => {
  await page.goto(story);
  const queue = page.getByRole('region', { name: 'Inbox queue' });
  await queue.getByRole('link', { name: /Prize Patrol/ }).click();
  await queue.getByRole('link', { name: /Observed|Link Sender/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await page.waitForTimeout(1000);
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
});

test('filter changes retain target, reason draft and confirmation, browser Back restores URL', async ({
  page,
}) => {
  await page.goto(story);
  await page
    .getByRole('region', { name: 'Inbox queue' })
    .getByRole('link', { name: /Observed|Link Sender/ })
    .click();
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Reason', { exact: true }).fill('Retain this review');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByLabel('Search inbox').fill('no matching members');
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Reason', { exact: true })).toHaveValue(
    'Retain this review'
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.goBack();
  await expect(page.getByLabel('Search inbox')).toHaveValue('');
  await page.getByLabel('Inbox freshness').selectOption('stale');
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page).toHaveURL(/selected=queue%3Apending_screening/);
});

test('direct selected URLs open narrow detail and Back restores row focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${story}&selected=${encodeURIComponent(observed)}`);
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeHidden();
  await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeVisible();
  await expect(page.locator(`[data-inbox-item="${observed}"]`)).toBeFocused();
});

test('resolved detail and result remain until Next follows the captured queue ordering', async ({
  page,
}) => {
  await page.goto(`${story}&selected=${encodeURIComponent(observed)}`);
  await expect(page.locator('[data-inbox-item]')).toHaveCount(6);
  const oldIds = await page
    .locator('[data-inbox-item]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-inbox-item')));
  await page.getByRole('button', { name: 'Dismiss alert', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Confirm Dismiss alert').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm Dismiss alert', exact: true })
    .click();
  await expect(page.getByTestId('submissions')).toHaveText('1');
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Request completed.'
  );
  await expect(page.locator(`[data-inbox-item="${observed}"]`)).toHaveCount(0);
  await expect(page).toHaveURL(/request=inbox-request/);
  const position = oldIds.indexOf(observed);
  const expected = oldIds[position + 1] ?? oldIds[position - 1];
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `selected=${encodeURIComponent(expected ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    )
  );
});

test('all six kinds show their own sources and screening has no mutation', async ({ page }) => {
  await page.goto(story);
  await expect(page.locator('[data-inbox-item]')).toHaveCount(6);
  await page
    .getByRole('region', { name: 'Inbox queue' })
    .getByRole('link', { name: /juniper/ })
    .click();
  const detail = page.getByRole('region', { name: 'Selected inbox item' });
  await expect(detail).toContainText('Complete reply with\nnewlines and trailing source text.');
  await expect(detail.getByRole('link', { name: 'proof.png', exact: true })).toHaveAttribute(
    'href',
    'https://example.com/proof.png'
  );
  await page
    .getByRole('region', { name: 'Inbox queue' })
    .getByRole('link', { name: /recovery member/ })
    .click();
  await expect(detail).toContainText('Reply unavailable');
  await expect(detail.getByRole('link', { name: 'Open reply in Discord' })).toHaveAttribute(
    'href',
    'https://discord.com/channels/guild-1/thread-1/reply-2'
  );
  await page
    .getByRole('region', { name: 'Inbox queue' })
    .getByRole('link', { name: /orbit/ })
    .click();
  await expect(detail).toContainText('7 days');
  await expect(detail).toContainText('Unknown date');
  await expect(detail.getByRole('button')).toHaveCount(0);
});

test('cross-guild detail cannot expose an action', async ({ page }) => {
  await page.goto(
    `${story.replace('--mixed', '--wrong-identity')}&selected=${encodeURIComponent(observed)}`
  );
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Item unavailable'
  );
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toHaveCount(0);
});

test('unknown or cross-record request IDs cannot block selected actions', async ({ page }) => {
  await page.goto(`${story}&selected=report%3Areport-1&request=inbox-request`);
  await expect(page.getByRole('button', { name: 'Dismiss report', exact: true })).toBeEnabled();
  await expect(page).not.toHaveURL(/request=/);
});

test('empty guild queue has a single empty state and restores no foreign selection', async ({
  page,
}) => {
  await page.goto(story.replace('--mixed', '--empty'));
  await expect(page.getByText('No inbox items match these filters.', { exact: true })).toHaveCount(
    1
  );
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toHaveCount(0);
});

test('browser Back returns to the queue row and preserves application history metadata', async ({
  page,
}) => {
  await page.goto(story);
  await page.evaluate(() =>
    window.history.replaceState(
      { ...window.history.state, applicationEntry: { token: 'keep-me' } },
      ''
    )
  );
  await page.locator(`[data-inbox-item="${observed}"]`).click();
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await page.goBack();
  await expect(page.locator(`[data-inbox-item="${observed}"]`)).toBeFocused();
  expect(await page.evaluate(() => window.history.state.applicationEntry)).toEqual({
    token: 'keep-me',
  });
});

test('eligibility loss closes confirmation and explains the change without submitting', async ({
  page,
}) => {
  await page.goto(`${story}&selected=${encodeURIComponent(observed)}`);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Preserve this draft');
  await dialog.getByLabel('Confirm Ban member').check();
  // A live update may arrive while the modal owns focus.
  await page.getByRole('button', { name: 'Revoke selected eligibility' }).evaluate((button) => {
    if (button instanceof HTMLButtonElement) button.click();
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Ban member is no longer available');
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByTestId('submissions')).toHaveText('0');
});

test('removal disables retained actions without advancing or discarding evidence', async ({
  page,
}) => {
  await page.goto(`${story}&selected=${encodeURIComponent(observed)}`);
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove observed row' }).click();
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
  await expect(page).toHaveURL(new RegExp(`selected=${encodeURIComponent(observed)}`));
});

test('explicit queue Back focuses the next survivor after row removal on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(story);
  await expect(page.locator('[data-inbox-item]')).toHaveCount(6);
  const ids = await page
    .locator('[data-inbox-item]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-inbox-item')));
  await page.locator(`[data-inbox-item="${observed}"]`).click();
  await page.getByRole('button', { name: 'Remove observed row' }).click();
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
  const index = ids.indexOf(observed);
  await expect(
    page.locator(`[data-inbox-item="${ids[index + 1] ?? ids[index - 1]}"]`)
  ).toBeFocused();
  await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeVisible();
});

test('session restoration contains ordering, focus and scroll only, with controls authoritative in the URL', async ({
  page,
}) => {
  await page.goto(story);
  await page.locator(`[data-inbox-item="${observed}"]`).click();
  await page.getByLabel('Search inbox').fill('Observed');
  await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
  const stored = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith('drasil:inbox:'))
      .map((key) => ({ key, value: JSON.parse(sessionStorage.getItem(key) ?? '{}') }))
  );
  expect(stored.length).toBeGreaterThan(0);
  for (const { key, value } of stored) {
    expect(key).not.toContain('Observed');
    expect(Object.keys(value).sort()).toEqual(['focusId', 'ordering', 'scrollTop']);
  }
  await page.reload();
  await expect(page.getByLabel('Search inbox')).toHaveValue('Observed');
  await expect(page.locator(`[data-inbox-item="${observed}"]`)).toBeFocused();
});

test('a matching envelope with a foreign payload is unavailable', async ({ page }) => {
  await page.goto(`${story.replace('--mixed', '--wrong-payload')}&selected=report%3Areport-1`);
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Item unavailable'
  );
  await expect(page.getByRole('button', { name: 'Dismiss report', exact: true })).toHaveCount(0);
});

test('completed same-record reads reconcile response loss only after explicit refresh completion', async ({
  page,
}) => {
  await page.goto(
    `${story.replace('--mixed', '--response-loss')}&selected=${encodeURIComponent(observed)}`
  );
  await page.getByRole('button', { name: 'Dismiss alert', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Confirm Dismiss alert').check();
  await dialog.getByRole('button', { name: 'Confirm Dismiss alert', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dismiss alert', exact: true })).toBeDisabled();
  await page.waitForTimeout(850);
  await expect(page.getByRole('button', { name: 'Dismiss alert', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh durable state', exact: true }).click();
  // Starting the read cannot reconcile the uncertain intent.
  await page.waitForTimeout(150);
  await expect(page.getByRole('button', { name: 'Dismiss alert', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Dismiss alert', exact: true })).toBeEnabled();
});

test('native record links carry a same-guild return descriptor and preserve modified clicks and browser Back', async ({
  page,
  context,
}) => {
  await context.route('**/admin/guild/guild-1/reports/report-1?**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><main>Report destination</main></html>',
    })
  );
  await page.goto(`${story}&selected=report%3Areport-1&q=Target`);
  const link = page.getByRole('link', { name: 'Open report', exact: true });
  const href = await link.getAttribute('href');
  const url = new URL(href ?? '', 'https://internal.invalid');
  const returnTo = url.searchParams.get('returnTo');
  expect(returnTo).toMatch(/^\/admin\/guild\/guild-1\/inbox\?/);
  expect(new URL(returnTo ?? '', url).searchParams.get('selected')).toBe('report:report-1');
  expect(new URL(returnTo ?? '', url).searchParams.get('q')).toBe('Target');
  const popupPromise = context.waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  const popup = await popupPromise;
  await expect(popup.getByText('Report destination')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Target user-300' })).toBeVisible();
  await popup.close();
  await link.click();
  await expect(page.getByText('Report destination')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Target user-300' })).toBeVisible();
  await expect(page.getByLabel('Search inbox')).toHaveValue('Target');
});

for (const width of [390, 1440])
  for (const theme of ['light', 'dark']) {
    test(`six selected sources, accessibility and reflow at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => localStorage.setItem('drasil-theme', value), theme);
      const scenarios = [
        {
          id: 'case:case-stale',
          kind: 'case',
          heading: 'Prize Patrol',
          source: 'They asked me to claim a prize through a short link and said it expires today.',
        },
        {
          id: 'report:report-1',
          kind: 'submitted-report',
          heading: 'Target user-300',
          source: 'They sent me a Nitro link and asked me to sign in before it expired.',
        },
        {
          id: observed,
          kind: 'observed-alert',
          heading: 'Observed User',
          source: 'Complete detection source text',
        },
        {
          id: 'queue:report_attention',
          kind: 'report-attention',
          heading: 'juniper',
          source: 'Complete reply with\nnewlines and trailing source text.',
        },
        {
          id: 'queue:support_attention',
          kind: 'support-attention',
          heading: 'recovery member',
          source: 'Reply unavailable',
        },
        { id: 'queue:pending_screening', kind: 'screening', heading: 'orbit', source: '7 days' },
      ];
      for (const scenario of scenarios) {
        await page.goto(`${story}&selected=${encodeURIComponent(scenario.id)}`);
        const detail = page.getByRole('region', { name: 'Selected inbox item' });
        await expect(
          detail.getByRole('heading', { name: scenario.heading, exact: true })
        ).toBeVisible();
        await expect(detail).toContainText(scenario.source);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(
          await page
            .locator('[data-foundation-theme]')
            .evaluate((root) => getComputedStyle(root).colorScheme)
        ).toBe(theme);
        await page.addScriptTag({ content: axe.source });
        const audit = await page.evaluate(async () => ({
          violations: (
            await window.axe.run(document.querySelector('[data-foundation-theme]') ?? document)
          ).violations,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));
        expect(audit.violations).toEqual([]);
        expect(audit.overflow).toBe(false);
        await page.screenshot({
          path: testInfo.outputPath(`${scenario.kind}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    });
  }

test('the current history entry restores its captured ordering ahead of later session metadata', async ({
  page,
}) => {
  await page.goto(story);
  await expect(page.locator('[data-inbox-item]')).toHaveCount(6);
  const oldIds = await page
    .locator('[data-inbox-item]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-inbox-item')));
  await page.locator(`[data-inbox-item="${observed}"]`).click();
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'Complete detection source text'
  );
  await page.getByLabel('Search inbox').fill('Observed');
  await page.evaluate(
    (id) =>
      sessionStorage.setItem(
        'drasil:inbox:guild-1:all',
        JSON.stringify({ ordering: [id, 'case:case-stale'], focusId: id, scrollTop: 0 })
      ),
    observed
  );
  await page.goBack();
  await expect(page.getByLabel('Search inbox')).toHaveValue('');
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  const expected = oldIds[oldIds.indexOf(observed) + 1];
  expect(expected).toBe('queue:pending_screening');
  await expect(page).toHaveURL(new RegExp(`selected=${encodeURIComponent(expected ?? '')}`));
});

test('a verified selected-record security request remains in the URL after eligibility changes', async ({
  page,
}) => {
  await page.goto(`${story}&selected=case%3Acase-stale&request=security-request`);
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
    'They asked me to claim a prize'
  );
  await expect(page).toHaveURL(/request=security-request/);
  await page.getByRole('button', { name: 'Revoke selected eligibility' }).click();
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toBeDisabled();
  await expect(page).toHaveURL(/request=security-request/);
});

for (const width of [1440, 390]) {
  test(`case decisions use the approved order and severity at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('drasil-theme', 'dark'));
    await page.goto(`${story}&selected=case%3Acase-stale`);
    const decisions = page.getByRole('region', { name: 'Case decisions', exact: true });
    await expect(decisions.getByRole('button')).toHaveText([
      'Verify member',
      'Close case',
      'Kick member',
      'Ban member',
    ]);
    const severity = await decisions.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const root = button.closest('[data-foundation-theme]');
        if (!root) throw new Error('Missing foundation');
        const tone = button.getAttribute('data-tone');
        const token =
          tone === 'positive'
            ? '--dr-positive'
            : tone === 'warning'
              ? '--dr-warning'
              : tone === 'danger'
                ? '--dr-danger'
                : '--dr-text';
        const sample = document.createElement('span');
        sample.style.color = `var(${token})`;
        root.appendChild(sample);
        const expected = getComputedStyle(sample).color;
        sample.remove();
        const actual = getComputedStyle(button);
        return { tone, color: actual.color, border: actual.borderTopColor, expected };
      })
    );
    expect(severity.map((value) => value.tone)).toEqual([
      'positive',
      'neutral',
      'warning',
      'danger',
    ]);
    for (const value of severity) {
      expect(value.color).toBe(value.expected);
      if (value.tone !== 'neutral') expect(value.border).toBe(value.expected);
    }
    await expect(
      page.getByRole('button', { name: 'Refresh notification', exact: true })
    ).toBeHidden();
    await page.getByRole('button', { name: 'Case tools', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Refresh notification', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Repair thread', exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`case-decisions-${width}-dark.png`),
      fullPage: true,
    });
  });
}

test('case tools retain their draft, request result and polling through disclosure changes', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`${story}&selected=case%3Acase-stale`);
  const tools = page.getByRole('region', { name: 'Case tools', exact: true });
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  await tools.getByRole('button', { name: 'Refresh notification', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Retained maintenance context');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  await tools.getByRole('button', { name: 'Refresh notification', exact: true }).click();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue(
    'Retained maintenance context'
  );
  await dialog.getByLabel('Confirm Refresh notification').check();
  await dialog.getByRole('button', { name: 'Confirm Refresh notification', exact: true }).click();
  await expect(tools.getByRole('status')).toContainText('Request queued.');
  await expect(page.getByTestId('submissions')).toHaveText('1');
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  const before = Number(await page.getByTestId('refreshes').textContent());
  await page.clock.runFor(2200);
  await expect(page.getByTestId('refreshes')).toHaveText(String(before + 1));
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  await expect(tools.getByRole('status')).toContainText('Request queued.');
  await page.getByRole('button', { name: 'Complete case request', exact: true }).click();
  await expect(tools.getByRole('status')).toContainText('Request completed.');
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  await tools.getByRole('button', { name: 'Case tools', exact: true }).click();
  await expect(tools.getByRole('status')).toContainText('Request completed.');
  const completedCount = await page.getByTestId('refreshes').textContent();
  await page.clock.runFor(4200);
  await expect(page.getByTestId('refreshes')).toHaveText(completedCount ?? '');
});

test('case tools close invalid confirmation with a visible explanation', async ({ page }) => {
  await page.goto(`${story}&selected=case%3Acase-stale`);
  await page.getByRole('button', { name: 'Case tools', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh notification', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Keep this contextual review');
  await dialog.getByLabel('Confirm Refresh notification').check();
  await page.getByRole('button', { name: 'Revoke selected eligibility' }).evaluate((element) => {
    if (element instanceof HTMLButtonElement) element.click();
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Refresh notification is no longer available'
  );
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByTestId('submissions')).toHaveText('0');
});
