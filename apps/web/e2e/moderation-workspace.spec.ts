import axe from 'axe-core';
import { expect, test } from '@playwright/test';
import {
  fullSource,
  fullStatement,
  workspaceIds as id,
  workspaceFixtures,
} from './workspaceFixtures';
const fixtures = workspaceFixtures();
test.beforeAll(() => fixtures.start());
test.afterAll(() => fixtures.stop());
test.beforeEach(async ({ context, baseURL }) => fixtures.reset(context, baseURL!));

for (const surface of ['inbox', 'canonical'] as const)
  test(`${surface} confirmation explains all pending cases and shared server context`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: surface === 'inbox' ? 320 : 1440, height: 1000 });
    await fixtures.pool.query(
      "insert into verification_events(id,server_id,user_id,status) values('91000000-0000-4000-8000-000000000021',$1,$2,'pending')",
      [id.guild, id.member]
    );
    const destination = surface === 'inbox' ? `inbox?selected=case:${id.case}` : `cases/${id.case}`;
    await page.goto(`/admin/guild/${id.guild}/${destination}`);
    for (const label of ['Verify member', 'Close case']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`Server ID ${id.guild}`);
      await expect(dialog).toContainText('all pending cases for this member in this server');
      await expect(dialog).toContainText(
        'restore eligible snapshotted roles under current role policy'
      );
      if (label === 'Close case')
        await expect(dialog).toContainText(
          'Close cannot release active compromised-account quarantine'
        );
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await fixtures.pool.query(
      "update verification_events set case_kind='compromised_account' where id=$1",
      [id.case]
    );
    await page.reload();
    await page.getByRole('button', { name: 'Verify and release', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Confirm account recovery');
    await expect(page.getByRole('dialog')).toContainText(
      'all pending cases for this member in this server'
    );
    await expect(page.getByRole('dialog')).toContainText(`Server ID ${id.guild}`);
    await page.screenshot({ path: testInfo.outputPath('confirmation.png'), fullPage: true });
  });

test('recovery and breach links select actual attention records with labelled source dates', async ({
  page,
}) => {
  await fixtures.pool.query(
    "update verification_events set case_kind='compromised_account' where id=$1",
    [id.case]
  );
  await fixtures.pool.query(
    "update moderation_queue_items set metadata=$2,updated_at='2026-10-25T12:00:00Z' where id=any($1::uuid[])",
    [
      [id.support, id.breach],
      {
        latest_message_at: '2026-10-01T12:00:00Z',
        latest_message_url: `https://discord.com/channels/${id.guild}/${id.channel}/${id.message}`,
      },
    ]
  );
  for (const [queueId, label] of [
    [id.support, 'Recovery reply'],
    [id.breach, 'Containment breach'],
  ]) {
    await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
    const recovery = page.getByRole('region', { name: 'Account containment and recovery' });
    await recovery.locator(`a[href*="selected=queue%3A${queueId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`selected=queue%3A${queueId}`));
    await expect(page.getByRole('region', { name: 'Selected inbox item' })).toContainText(
      new RegExp(label, 'i')
    );
    const row = page.locator(`[data-inbox-item="queue:${queueId}"]`);
    await expect(row).toContainText(label);
    await expect(row).toContainText(queueId === id.breach ? 'Posted' : 'Reply sent');
    await expect(row.locator('time').first()).toHaveAttribute(
      'datetime',
      '2026-10-01T12:00:00.000Z'
    );
    await expect(row).toContainText('Queue updated');
    if (queueId === id.breach) {
      await expect(row).toContainText(id.channel);
      await expect(row).not.toContainText('Recovery thread');
      await expect(row.locator('[data-severity="danger"]')).toBeVisible();
    }
  }
});

for (const surface of ['inbox', 'canonical'] as const)
  test(`${surface} keeps unknown and reviewed ban receipts inspectable with exact identity`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: surface === 'inbox' ? 320 : 1440, height: 1000 });
    const result = await fixtures.pool.query(
      "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,report_intake_id,detection_event_id,idempotency_key,status,result,requested_at,failed_at,updated_at) values($1,$2,'web','ban_observed_detection',$3,$4,$5,'review-ban','failed',$6,'2026-10-24T12:00:00Z','2026-10-25T12:00:00Z','2026-10-25T12:00:00Z') returning id",
      [
        id.guild,
        id.actor,
        id.member,
        id.report,
        id.reportDetection,
        { observed_ban_result: { status: 'ban_outcome_unknown', operationId: 'review-operation' } },
      ]
    );
    const requestId = result.rows[0].id as string;
    await page.goto(
      `/admin/guild/${id.guild}/${surface === 'inbox' ? `inbox?selected=report:${id.report}` : `reports/${id.report}`}`
    );
    const receipt = page.getByRole('status').filter({ hasText: 'Ban outcome unknown' });
    await expect(receipt).toContainText('Operation review-operation');
    await expect(receipt).toContainText(`/review-report-ban operation:review-operation`);
    await expect(receipt).toContainText(`Requested by ${id.actor}`);
    await expect(receipt.locator('time').first()).toHaveAttribute(
      'datetime',
      '2026-10-24T12:00:00.000Z'
    );
    await expect(receipt.getByRole('link', { name: `Request ${requestId}` })).toHaveAttribute(
      'href',
      `/admin/guild/${id.guild}/operations?request=${requestId}#request-${requestId}`
    );
    await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('unknown-receipt.png'), fullPage: true });
    await fixtures.pool.query(
      'update moderation_action_requests set result=$2,updated_at=now() where id=$1',
      [
        requestId,
        {
          observed_ban_result: {
            status: 'ban_reviewed_no_current_ban',
            operationId: 'review-operation',
          },
        },
      ]
    );
    await page.reload();
    const reviewed = page.getByRole('status').filter({ hasText: 'Reviewed: no current ban' });
    await expect(reviewed).toContainText('historical outcome remains uncertain');
    await expect(reviewed).toContainText(`Request ${requestId}`);
    await expect(reviewed).toContainText('Matching claims released.');
    await page.screenshot({ path: testInfo.outputPath('reviewed-receipt.png'), fullPage: true });
    await fixtures.pool.query(
      "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,verification_event_id,idempotency_key,status) select $1,$2,'web','refresh_case_notification',$3,$4,'newer-'||n,'completed' from generate_series(1,26) n",
      [id.guild, id.actor, id.member, id.case]
    );
    await reviewed.getByRole('link', { name: `Request ${requestId}` }).click();
    await expect(page.locator(`[id="request-${requestId}"]`)).toBeVisible();
  });

test('completed generic maintenance stays historical after reload', async ({ page }) => {
  const result = await fixtures.pool.query(
    "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,verification_event_id,idempotency_key,status,completed_at,result) values($1,$2,'web','refresh_case_notification',$3,$4,'maintenance-completed','completed','2026-10-24T12:00:00Z',$5) returning id",
    [id.guild, id.actor, id.member, id.case, { action_type: 'refresh_case_notification' }]
  );
  await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
  await page.reload();
  await page.getByRole('button', { name: 'Case tools', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Refresh notification', exact: true });
  await expect(trigger).toBeDisabled();
  const receipt = page
    .getByRole('status')
    .filter({ hasText: 'This request already completed for this case.' });
  await expect(receipt).toContainText(`Request ${result.rows[0].id}`);
  await expect(receipt).toContainText(`Requested by ${id.actor}`);
  await expect(receipt.locator('time').last()).toHaveAttribute(
    'datetime',
    '2026-10-24T12:00:00.000Z'
  );
});

for (const via of ['canonical', 'history'] as const)
  for (const remaining of ['next', 'previous', 'empty', 'arrival'] as const)
    test(`explicit ${via} return continues to ${remaining} after selected case resolves`, async ({
      page,
    }) => {
      const previous = '91000000-0000-4000-8000-000000000021';
      const next = '91000000-0000-4000-8000-000000000022';
      const arrival = '91000000-0000-4000-8000-000000000023';
      await fixtures.pool.query(
        "insert into verification_events(id,server_id,user_id,status,created_at) values($1,$3,$4,'pending','2026-10-20T14:40:00Z'),($2,$3,$4,'pending','2026-10-22T14:40:00Z')",
        [previous, next, id.guild, id.member]
      );
      await fixtures.pool.query(
        'update verification_events set updated_at=created_at where server_id=$1',
        [id.guild]
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/admin/guild/${id.guild}/inbox?kind=case&freshness=all&sort=oldest`);
      await page.locator(`[data-inbox-item="case:${id.case}"]`).click();
      await expect(page.getByRole('region', { name: 'Selected inbox item' })).toBeFocused();
      await page.getByRole('link', { name: 'Open case', exact: true }).click();
      const resolve =
        remaining === 'next'
          ? [id.case]
          : remaining === 'previous'
            ? [id.case, next]
            : [id.case, next, previous];
      await fixtures.pool.query(
        "update verification_events set status='verified',resolved_at=now() where id=any($1::uuid[])",
        [resolve]
      );
      if (remaining === 'arrival')
        await fixtures.pool.query(
          "insert into verification_events(id,server_id,user_id,status,created_at) values($1,$2,$3,'pending','2026-10-19T14:40:00Z')",
          [arrival, id.guild, id.member]
        );
      if (via === 'canonical')
        await page
          .getByRole('link', { name: /Back to inbox/ })
          .first()
          .click();
      else await page.goBack();
      await expect(
        page.getByRole('combobox', { name: 'Inbox kind', includeHidden: true })
      ).toHaveValue('case');
      await expect(
        page.getByRole('combobox', { name: 'Inbox sort', includeHidden: true })
      ).toHaveValue('oldest');
      if (remaining === 'empty') {
        await expect(page).not.toHaveURL(/selected=/);
        await expect(
          page.getByText('No inbox items match these filters.', { exact: true })
        ).toHaveCount(1);
        await expect(page.getByRole('region', { name: 'Selected inbox item' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: /^Inbox/ })).toBeFocused();
      } else {
        const selected =
          remaining === 'next' ? next : remaining === 'previous' ? previous : arrival;
        await expect(page).toHaveURL(new RegExp(`selected=case%3A${selected}`));
        await expect(page.getByRole('region', { name: 'Selected inbox item' })).toBeFocused();
        await page.reload();
        await expect(page).toHaveURL(new RegExp(`selected=case%3A${selected}`));
        await page.getByRole('button', { name: 'Back to inbox', exact: true }).click();
        await expect(page.locator(`[data-inbox-item="case:${selected}"]`)).toBeFocused();
        await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeVisible();
      }
    });

// This journey runs against the application routes. Provider/worker effects belong
// to the controlled test environment; the browser never replaces workspace reads.
test('review report, cancel then confirm dismissal, explicitly continue to a case and return', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/admin/guild/${id.guild}/inbox?kind=all&freshness=all&sort=oldest`);
  await expect(page.getByRole('combobox', { name: 'Inbox kind' })).toHaveValue('all');
  await page.locator(`[data-inbox-item="report:${id.report}"]`).click();
  const selected = page.getByRole('region', { name: 'Selected inbox item' });
  await expect(selected.getByText(fullStatement, { exact: true })).toBeVisible();
  await expect(selected.getByRole('link', { name: /screenshot/i })).toHaveAttribute(
    'href',
    /^https:/
  );
  await selected.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selected.getByRole('button', { name: 'Dismiss report', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm Dismiss report', exact: true }).click();
  await expect(
    selected.getByRole('status').filter({ hasText: /dismissed|closed without/i })
  ).toBeVisible();
  await expect(page).toHaveURL(/selected=/);
  await page.getByRole('button', { name: 'Next item', exact: true }).click();
  await page.getByRole('combobox', { name: 'Inbox kind' }).selectOption('case');
  await page.getByRole('region', { name: 'Inbox queue' }).getByRole('link').first().click();
  await page.getByRole('link', { name: 'Open case', exact: true }).click();
  await expect(page).toHaveURL(/cases\/[^?]+\?returnTo=/);
  await page.getByRole('button', { name: 'View conversation' }).first().click();
  await expect(
    page
      .getByRole('region', { name: 'Channel conversation' })
      .getByText(fullSource, { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to source', exact: true }).click();
  await page.getByRole('button', { name: 'Verify member', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm Verify member' }).click();
  await expect
    .poll(async () =>
      Number(
        (
          await fixtures.pool.query(
            "select count(*) from moderation_action_requests where server_id=$1 and verification_event_id=$2 and status='queued'",
            [id.guild, id.case]
          )
        ).rows[0].count
      )
    )
    .toBe(1);
  await fixtures.finishCase();
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await page
    .getByRole('link', { name: /Back to inbox/ })
    .first()
    .click();
  await expect(page.getByRole('combobox', { name: 'Inbox kind' })).toHaveValue('case');
  await expect(page.getByRole('combobox', { name: 'Inbox sort' })).toHaveValue('oldest');
  await expect(page).not.toHaveURL(/selected=/);
  await expect(page.getByText('No inbox items match these filters.', { exact: true })).toHaveCount(
    1
  );
  await expect(page.getByRole('heading', { name: /^Inbox/ })).toBeFocused();
  expect(errors).toEqual([]);
});

for (const kind of [
  'case',
  'submitted_report',
  'observed_alert',
  'report_attention',
  'support_attention',
  'pending_screening',
]) {
  test(`release matrix: ${kind} is readable through the selected HTTP route`, async ({ page }) => {
    await page.goto(`/admin/guild/${id.guild}/inbox?kind=${kind}&freshness=all`);
    await expect(page.getByRole('combobox', { name: 'Inbox kind' })).toHaveValue(kind);
    await page.getByRole('region', { name: 'Inbox queue' }).getByRole('link').first().click();
    await expect(
      page.getByRole('region', { name: 'Selected inbox item' }).getByRole('heading', { level: 1 })
    ).toBeVisible();
    await expect(page.getByText('Item unavailable.')).toHaveCount(0);
  });
}

test('theme toggle is independent of fallback fonts and keyboard preference persists across routes', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
  const toggle = page.getByRole('button', { name: 'Toggle light and dark mode', exact: true });
  await expect(toggle).toHaveAttribute('title', 'Switch to light mode');
  await expect(toggle).toHaveCSS('width', '32px');
  await expect(toggle).toHaveCSS('height', '32px');
  await toggle.evaluate((button) => {
    button.style.fontFamily = 'Noto Color Emoji';
  });
  const emojiFont = await toggle.screenshot();
  await toggle.evaluate((button) => {
    button.style.fontFamily = 'DejaVu Sans';
  });
  const textFont = await toggle.screenshot();
  await testInfo.attach('theme-icon-emoji-font', { body: emojiFont, contentType: 'image/png' });
  await testInfo.attach('theme-icon-text-font', { body: textFont, contentType: 'image/png' });
  expect(emojiFont.equals(textFont), 'Theme icon must not change with platform font fallback').toBe(
    true
  );
  await toggle.evaluate((button) => button.style.removeProperty('font-family'));
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto(`/admin/guild/${id.guild}/inbox`);
  await page.reload();
  await expect(toggle).toHaveAttribute('title', 'Switch to dark mode');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('drasil-theme'))).toBe('light');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
  await expect(toggle).toHaveAttribute('title', 'Switch to light mode');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('early reporter reply and breach preserve distinct identities; screening has no decision', async ({
  page,
}) => {
  await page.goto(`/admin/guild/${id.guild}/inbox?selected=queue:${id.reportAttention}`);
  const selected = page.getByRole('region', { name: 'Selected inbox item' });
  await expect(selected.getByText('Target not confirmed', { exact: true })).toBeVisible();
  await expect(selected.getByRole('button', { name: 'Ban member', exact: true })).toHaveCount(0);
  await selected.getByRole('link', { name: 'Open report', exact: true }).click();
  await expect(page.getByText('Target not confirmed', { exact: true })).toBeVisible();
  await page.goto(`/admin/guild/${id.guild}/inbox?selected=queue:${id.breach}`);
  await expect(selected.getByText('Containment breach', { exact: true })).toBeVisible();
  await expect(selected.getByText(`Member ID ${id.member}`, { exact: true })).toBeVisible();
  await page.goto(`/admin/guild/${id.guild}/inbox?selected=queue:${id.screening}`);
  await expect(
    selected.getByRole('heading', { name: 'Discord membership screening' })
  ).toBeVisible();
  await expect(selected.getByRole('button')).toHaveCount(0);
});

test('canonical early report retains evidence and acknowledgment after attention disappears', async ({
  page,
}) => {
  const evidence = 'Unconfirmed report evidence stays readable after acknowledging the reply.';
  await fixtures.pool.query(
    "insert into report_intake_evidence(intake_id,kind,content) values($1,'reporter_text',$2)",
    [id.early, evidence]
  );
  await page.goto(`/admin/guild/${id.guild}/inbox?selected=queue:${id.reportAttention}`);
  await page.getByRole('link', { name: 'Open report', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id.early}`));
  await expect(page.getByText(evidence, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge reply', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm Acknowledge reply', exact: true }).click();
  await expect(page.getByText('Reply acknowledged.', { exact: true })).toBeVisible();
  // Fresh server props must remove eligibility without replacing the report or its action instance.
  await expect(page.getByRole('button', { name: 'Acknowledge reply', exact: true })).toBeDisabled();
  await expect
    .poll(
      async () =>
        (
          await fixtures.pool.query('select id from moderation_queue_items where id=$1', [
            id.reportAttention,
          ])
        ).rowCount
    )
    .toBe(0);
  await expect(
    page.getByText('Reporter follow-up · collecting evidence', { exact: true })
  ).toBeVisible();
  await expect(page.getByText(evidence, { exact: true })).toBeVisible();
  await expect(page.getByText('Reply acknowledged.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(evidence, { exact: true })).toBeVisible();
  await expect(page.getByText('Target not confirmed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acknowledge reply', exact: true })).toHaveCount(0);
});

test('direct resolved case and vanished pending rows remain readable after reload', async ({
  page,
}) => {
  await fixtures.pool.query(
    "update verification_events set status='verified',resolved_at=now() where id=$1",
    [id.case]
  );
  await fixtures.pool.query("update report_intakes set status='dismissed' where id=$1", [
    id.report,
  ]);
  await fixtures.pool.query('delete from moderation_queue_items where id=$1', [id.observedQueue]);
  for (const selected of [`case:${id.case}`, `report:${id.report}`, `detection:${id.observed}`]) {
    await page.goto(`/admin/guild/${id.guild}/inbox?selected=${selected}`);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Selected inbox item' }).getByRole('heading', { level: 1 })
    ).toBeVisible();
  }
  await page.goto(
    `/admin/guild/${id.guild}/cases/${id.case}?returnTo=/admin/guild/${id.foreignGuild}/inbox`
  );
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to inbox/ })).toHaveAttribute(
    'href',
    `/admin/guild/${id.guild}/inbox`
  );
});

test('concurrent resolution rejects the captured decision and keeps selected evidence', async ({
  page,
}) => {
  await page.goto(`/admin/guild/${id.guild}/inbox?selected=case:${id.case}`);
  await page.getByRole('button', { name: 'Verify member', exact: true }).click();
  await fixtures.pool.query(
    "update verification_events set status='verified',resolved_at=now() where id=$1",
    [id.case]
  );
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm Verify member', exact: true }).click();
  await expect(page.getByText(/Case action is no longer available/)).toBeVisible();
  await expect(page.getByText(fullSource, { exact: true }).first()).toBeVisible();
  expect(
    Number(
      (
        await fixtures.pool.query(
          'select count(*) from moderation_action_requests where server_id=$1',
          [id.guild]
        )
      ).rows[0].count
    )
  ).toBe(0);
});

for (const foreign of [true, false])
  test(`tracked request from another ${foreign ? 'guild' : 'record'} cannot attach to selected report`, async ({
    page,
  }) => {
    const result = await fixtures.pool.query(
      "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,report_intake_id,detection_event_id,idempotency_key,status) values($1,$2,'web','ban_observed_detection',$3,$4,$5,'unrelated-request','failed') returning id",
      [foreign ? id.foreignGuild : id.guild, id.actor, id.member, id.linkedReport, id.detection]
    );
    await page.goto(
      `/admin/guild/${id.guild}/inbox?selected=report:${id.report}&request=${result.rows[0].id}`
    );
    await expect(page).not.toHaveURL(/request=/);
    await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeEnabled();
    if (foreign) {
      await page.goto(`/admin/guild/${id.guild}/operations?request=${result.rows[0].id}`);
      await expect(page.locator(`[id="request-${result.rows[0].id}"]`)).toHaveCount(0);
    }
  });

for (const outcome of ['failed', 'unknown'] as const)
  test(`report ban retains exact durable ${outcome} outcome`, async ({ page }) => {
    await page.goto(`/admin/guild/${id.guild}/reports/${id.report}`);
    await page.getByRole('button', { name: 'Ban member', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Reason', { exact: true })
      .fill('Reviewed the complete source.');
    await page.getByRole('dialog').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
    await expect
      .poll(async () =>
        Number(
          (
            await fixtures.pool.query(
              'select count(*) from moderation_action_requests where server_id=$1 and report_intake_id=$2',
              [id.guild, id.report]
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await fixtures.pool.query(
      "update moderation_action_requests set status='failed',failed_at=now(),updated_at=now(),last_error=$3,result=$4 where server_id=$1 and report_intake_id=$2",
      [
        id.guild,
        id.report,
        outcome === 'failed' ? 'Controlled provider failure' : null,
        outcome === 'unknown'
          ? JSON.stringify({
              observed_ban_result: {
                status: 'ban_outcome_unknown',
                operationId: 'controlled-operation',
              },
            })
          : null,
      ]
    );
    await expect(
      page
        .getByText(outcome === 'failed' ? 'Controlled provider failure' : /Ban outcome unknown/i)
        .first()
    ).toBeVisible();
    await expect(page.getByText('Banned', { exact: true })).toHaveCount(0);
  });

test('unavailable live source retains full saved evidence and keyboard return', async ({
  page,
}) => {
  fixtures.setUnavailable(true);
  await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
  const open = page.getByRole('button', { name: 'View conversation' }).first();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('region', { name: 'Channel conversation' })
      .getByText(/no longer available|do not have access/)
  ).toBeVisible();
  await expect(page.getByText(fullSource, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to source', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(open).toBeFocused();
});

for (const state of ['incomplete', 'parked'] as const)
  test(`quarantine saved preview and ${state} recovery state use current case bindings`, async ({
    page,
  }) => {
    await fixtures.pool.query(
      'update servers set settings=settings || \'{"account_quarantine_enabled":true}\' where guild_id=$1',
      [id.guild]
    );
    await fixtures.pool.query(
      "update verification_events set case_kind='compromised_account',containment_status=$2,attention_state=$3 where id=$1",
      [
        id.case,
        state === 'parked' ? 'contained' : 'incomplete',
        state === 'parked' ? 'parked' : 'review_required',
      ]
    );
    await fixtures.pool.query(
      "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,verification_event_id,idempotency_key,status,completed_at,result) values($1,$2,'web','preview_account_quarantine',$3,$4,'owned-preview','completed',now(),$5)",
      [
        id.guild,
        id.actor,
        id.member,
        id.case,
        JSON.stringify({
          action_type: 'preview_account_quarantine',
          previewed_at: new Date().toISOString(),
          enabled: true,
          can_contain: false,
          case_role_ready: true,
          admin_notification_ready: true,
          recovery_thread_ready: true,
          planned_roles: [],
          retained_roles: [],
          privileged_roles: [],
          unremovable_privilege_reasons: ['Original unremovable role evidence'],
          lockdown_error_count: 1,
        }),
      ]
    );
    await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
    await expect(
      page.getByRole('heading', { name: 'Account containment and recovery' })
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Saved quarantine preview' })).toBeVisible();
    await expect(page.getByText('Original unremovable role evidence')).toBeVisible();
    const attempt = page.getByRole('button', { name: 'Attempt account quarantine', exact: true });
    if (state === 'parked') await expect(attempt).toBeDisabled();
    else await expect(attempt).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Close case', exact: true })).toHaveCount(0);
  });

for (const passEffect of ['evidence_only', 'verify_join_only'] as const)
  test(`security check generations preserve ${passEffect} pass effects`, async ({ page }) => {
    await fixtures.pool.query(
      "insert into captcha_challenges(verification_event_id,server_id,user_id,provider,method_revision,status,request_source,pass_effect,generation,case_revision_at_issue,link_token_hash,expires_at) values($1,$2,$3,'discord_image',2,'failed','moderator',$4,3,0,'workspace-controlled-link',now()+interval '10 minutes')",
      [id.case, id.guild, id.member, passEffect]
    );
    await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
    await expect(page.getByText(/Method revision 2 · Generation 3/)).toBeVisible();
    await expect(
      page.getByText(
        passEffect === 'evidence_only'
          ? /A pass leaves the case open/
          : /A pass requests automatic verification/
      )
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retry security check', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('generation 3');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await fixtures.pool.query(
      "update captcha_challenges set status='passed',passed_at=now() where verification_event_id=$1",
      [id.case]
    );
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Retry security check', exact: true })
    ).toHaveCount(0);
  });

for (const state of ['blocked', 'partial', 'finalization'] as const)
  test(`cleanup ${state} uses dedicated frozen job and preserves ordinary ban`, async ({
    page,
  }) => {
    await fixtures.pool.query(
      'update verification_events set private_evidence_thread_id=$2 where id=$1',
      [id.case, id.thread]
    );
    const result = await fixtures.pool.query(
      "insert into message_deletion_jobs(server_id,user_id,verification_event_id,requested_by,actor_surface,mode,scope,status,coverage,reason,evidence_thread_id,previewed_at,candidate_count,preserved_count,deleted_count,permission_denied_count,ban_status,case_finalization_status) values($1,$2,$3,$4,'web_case',$5,'source_message',$6,$7,'Reviewed frozen source',$8,now(),2,2,$9,$10,$11,$12) returning id",
      [
        id.guild,
        id.member,
        id.case,
        id.actor,
        state === 'blocked' ? 'delete_only' : 'ban_with_cleanup',
        state === 'blocked' ? 'ready' : 'completed',
        state === 'blocked' ? 'indexing' : 'ready',
        id.thread,
        state === 'blocked' ? 0 : 1,
        state === 'partial' ? 1 : 0,
        state === 'blocked' ? 'not_requested' : 'succeeded',
        state === 'finalization' ? 'failed' : state === 'partial' ? 'succeeded' : 'not_applicable',
      ]
    );
    const jobId = result.rows[0].id;
    for (const suffix of ['1', '2'])
      await fixtures.pool.query(
        "insert into message_deletion_items(job_id,message_id,channel_id,author_id,message_created_at,content_preview,discovery_source,evidence_status,status) values($1,$2,$3,$4,now(),$5,'source_message','preserved',$6)",
        [
          jobId,
          id.message + suffix,
          id.channel,
          id.member,
          fullSource,
          suffix === '1' && state !== 'blocked' ? 'deleted' : 'pending',
        ]
      );
    if (state === 'finalization')
      await fixtures.pool.query("update verification_events set status='banned' where id=$1", [
        id.case,
      ]);
    await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
    await expect(page.getByRole('heading', { name: 'Message cleanup', exact: true })).toBeVisible();
    if (state === 'blocked') {
      await expect(page.getByText(/Discord is indexing/)).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Delete 2 messages', exact: true })
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeEnabled();
    } else {
      await page
        .getByRole('combobox', { name: 'Cleanup action', exact: true })
        .selectOption('ban_with_cleanup');
      await expect(page.getByText(/Cleanup completed. 1 deleted/)).toBeVisible();
      if (state === 'finalization') {
        await page.getByRole('button', { name: 'Retry case finalization', exact: true }).click();
        await page.getByRole('dialog').getByRole('checkbox').check();
        await page
          .getByRole('button', { name: 'Confirm Retry case finalization', exact: true })
          .click();
        await expect
          .poll(async () =>
            Number(
              (
                await fixtures.pool.query(
                  'select count(*) from moderation_action_requests where server_id=$1 and message_deletion_job_id=$2',
                  [id.guild, jobId]
                )
              ).rows[0].count
            )
          )
          .toBe(1);
        await fixtures.pool.query(
          "update message_deletion_jobs set case_finalization_status='succeeded',updated_at=now() where id=$1",
          [jobId]
        );
        await fixtures.pool.query(
          "update moderation_action_requests set status='completed',completed_at=now(),updated_at=now() where message_deletion_job_id=$1",
          [jobId]
        );
        await expect(
          page.getByText('Ban succeeded. Case finalization succeeded.', { exact: true })
        ).toBeVisible();
        expect(
          Number(
            (
              await fixtures.pool.query(
                'select count(*) from message_deletion_jobs where verification_event_id=$1',
                [id.case]
              )
            ).rows[0].count
          )
        ).toBe(1);
      }
    }
    await page.getByRole('link', { name: 'View cleanup job', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/message-cleanup/${jobId}$`));
    await expect(
      page.getByRole('heading', { name: 'Message outcomes', exact: true })
    ).toBeVisible();
  });

for (const theme of ['light', 'dark'] as const)
  for (const width of [320, 390, 1024, 1440]) {
    test(`built workspace ${theme} at ${width}px keeps source, context and focused targets visible @workspace-visual`, async ({
      page,
    }) => {
      await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
      for (const table of ['report_intakes', 'verification_events', 'moderation_queue_items']) {
        await fixtures.pool.query(
          `update ${table} set updated_at='2026-10-24T12:00:00Z'::timestamptz + right(id::text,3)::int * interval '1 minute' where server_id=$1`,
          [id.guild]
        );
      }
      await fixtures.pool.query(
        "update report_intakes set created_at='2026-10-21T14:40:00Z' where server_id=$1",
        [id.guild]
      );
      await fixtures.pool.query(
        "update report_intake_evidence set created_at='2026-10-21T14:40:00Z' where intake_id in (select id from report_intakes where server_id=$1)",
        [id.guild]
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
      await expect(page.getByText(fullSource, { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      // Exercise sticky behavior with a scrollable viewport, even for a short ordinary case.
      await page.setViewportSize({ width, height: 600 });
      const headline = page.getByRole('heading', { name: 'Case member', exact: true });
      await headline.evaluate((node) =>
        window.scrollTo(0, Math.ceil(node.getBoundingClientRect().bottom + window.scrollY))
      );
      await expect(page.getByLabel('Member for these actions', { exact: true })).toContainText(
        id.member
      );
      const sources = page.getByRole('navigation', { name: 'Evidence sources' });
      for (const name of width < 1000 ? ['Checks', 'History'] : []) {
        const jump = sources.getByRole('link', { name: new RegExp(`^${name}`) });
        await jump.focus();
        await page.keyboard.press('Enter');
        const focused = page.locator(':focus');
        await expect(focused).toHaveAttribute('tabindex', '-1');
        const top = await focused.evaluate((node) => node.getBoundingClientRect().top);
        expect(top).toBeGreaterThanOrEqual(0);
      }
      const sourceJump = sources.getByRole('link', { name: /Source message/ }).first();
      await sourceJump.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(':focus')).toHaveAttribute('tabindex', '-1');
      const actionBar = page.getByRole('region', { name: 'Case decisions' }).locator('..');
      await expect(actionBar).toHaveCSS('position', 'sticky');
      await expect(page.getByLabel('Member for these actions', { exact: true })).toContainText(
        id.member
      );
      await expect
        .poll(() =>
          actionBar.evaluate((node) => {
            const bar = node.getBoundingClientRect();
            const focusedTop = document.activeElement?.getBoundingClientRect().top ?? -1;
            return Math.min(bar.top, focusedTop - bar.bottom);
          })
        )
        .toBeGreaterThanOrEqual(0);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(
        async () =>
          (
            await axe.run(document, {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
            })
          ).violations
      );
      expect(violations).toEqual([]);
      await page.getByRole('button', { name: 'Ban member', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toContainText(id.member);
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeFocused();
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot(`workspace-case-${theme}-${width}.png`, {
        fullPage: true,
      });
      await page.goto(`/admin/guild/${id.guild}/inbox`);
      await expect(page).toHaveScreenshot(`workspace-inbox-${theme}-${width}.png`, {
        fullPage: true,
      });
    });
  }

test('selected reads and confirmed mutations reauthorize after initial page access', async ({
  page,
}) => {
  await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
  await page.getByRole('button', { name: 'Verify member', exact: true }).click();
  fixtures.setUnauthorized(true);
  const response = await page.request.get(`/api/admin/guild/${id.guild}/inbox/case:${id.case}`);
  expect(response.status()).toBe(403);
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm Verify member', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(
    Number(
      (
        await fixtures.pool.query(
          'select count(*) from moderation_action_requests where server_id=$1',
          [id.guild]
        )
      ).rows[0].count
    )
  ).toBe(0);
});

test('native Back restores the filtered selection after canonical record navigation', async ({
  page,
}) => {
  await page.goto(`/admin/guild/${id.guild}/inbox?kind=case&sort=oldest&selected=case:${id.case}`);
  await page.getByRole('link', { name: 'Open case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Case member', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'Inbox kind' })).toHaveValue('case');
  await expect(page.getByRole('combobox', { name: 'Inbox sort' })).toHaveValue('oldest');
  await expect(page).toHaveURL(new RegExp(`selected=case(?:%3A|:)${id.case}`));
  await expect(
    page
      .getByRole('region', { name: 'Selected inbox item' })
      .getByRole('heading', { name: 'Case member', exact: true })
  ).toBeVisible();
});

test('ordinary case reads saved sources first and keeps inactive tools and their drafts on demand', async ({
  page,
}) => {
  await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
  const source = page.getByRole('region', { name: 'Records from one source message' });
  const tools = page.getByRole('button', { name: 'Case tools', exact: true });
  await expect(
    page.getByRole('button', { name: 'Request security check', exact: true })
  ).toBeHidden();
  await expect(tools).toHaveAttribute('aria-expanded', 'false');
  await expect(source.getByText('Saved with case', { exact: true })).toBeVisible();
  await expect(source.getByText('Submitted with report', { exact: true })).toBeVisible();
  const sourceTop = await source.evaluate((node) => node.getBoundingClientRect().top);
  expect(sourceTop).toBeLessThan(await tools.evaluate((node) => node.getBoundingClientRect().top));
  await tools.click();
  await page.getByRole('button', { name: 'Request security check', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Retain my review context');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await tools.click();
  await tools.click();
  await page.getByRole('button', { name: 'Request security check', exact: true }).click();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue(
    'Retain my review context'
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

for (const surface of ['inbox', 'canonical'] as const)
  for (const outcome of ['ban_outcome_unknown', 'banned_updates_pending'] as const)
    test(`${surface} restores claimed report ${outcome} after reload and reopen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: surface === 'inbox' ? 390 : 1440, height: 1000 });
      const result = await fixtures.pool.query<{ id: string }>(
        "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,report_intake_id,detection_event_id,idempotency_key,status,completed_at) values($1,$2,'web','ban_observed_detection',$3,$4,$5,'claimed-report-ban','completed',now()) returning id",
        [id.guild, id.actor, id.member, id.report, id.reportDetection]
      );
      const requestId = result.rows[0].id;
      await fixtures.pool.query(
        'update moderation_action_requests set result=$2,metadata=$3 where id=$1',
        [
          requestId,
          { observed_ban_result: { status: outcome, operationId: requestId } },
          {
            report_ban_phase:
              outcome === 'ban_outcome_unknown' ? 'reconciliation_required' : 'discord_confirmed',
            report_ban_retry_count: 1,
            report_ban_retry_at: '2026-10-26T12:00:00Z',
            report_ban_lease_until: '2026-10-26T12:00:00Z',
            report_ban_last_error: 'Controlled provider interruption',
          },
        ]
      );
      await fixtures.pool.query(
        "update report_intakes set metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb where id=$1",
        [id.report, { report_ban_operation_id: requestId }]
      );
      await fixtures.pool.query(
        "update detection_events set metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb where id=$1",
        [id.reportDetection, { report_ban_operation_id: requestId, observed_action: 'ban' }]
      );
      const href = `/admin/guild/${id.guild}/${surface === 'inbox' ? `inbox?selected=report:${id.report}` : `reports/${id.report}`}`;
      const assertReceipt = async () => {
        const receipt = page.getByRole('status').filter({ hasText: `Operation ${requestId}` });
        await expect(receipt).toContainText(
          outcome === 'ban_outcome_unknown'
            ? 'Ban outcome unknown'
            : 'Record and notification updates are pending.'
        );
        await expect(receipt).toContainText(`Requested by ${id.actor}`);
        await expect(receipt.getByRole('link', { name: `Request ${requestId}` })).toHaveAttribute(
          'href',
          `/admin/guild/${id.guild}/operations?request=${requestId}#request-${requestId}`
        );
        if (outcome === 'ban_outcome_unknown')
          await expect(receipt).toContainText(`/review-report-ban operation:${requestId}`);
        await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Dismiss report', exact: true })).toHaveCount(
          0
        );
      };
      await page.goto(href);
      await assertReceipt();
      await page.reload();
      await assertReceipt();
      await page.goto(`/admin/guild/${id.guild}/history`);
      await page.goto(href);
      await assertReceipt();
      await page.getByRole('link', { name: `Request ${requestId}` }).click();
      await expect(page.locator(`[id="request-${requestId}"]`)).toBeVisible();
    });

for (const empty of [false, true])
  test(`parked recovery remains discoverable with ${empty ? 'empty' : 'active'} inbox after return and reload`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: empty ? 390 : 1440, height: 1000 });
    const foreignCase = '91000000-0000-4000-8000-000000000031';
    await fixtures.pool.query(
      "update verification_events set case_kind='compromised_account',attention_state='parked',containment_status='contained',parked_at='2026-10-25T12:00:00Z',parked_by=$2 where id=$1",
      [id.case, id.actor]
    );
    await fixtures.pool.query(
      "insert into verification_events(id,server_id,user_id,status,case_kind,attention_state,containment_status) values($1,$2,$3,'pending','compromised_account','parked','contained')",
      [foreignCase, id.foreignGuild, id.member]
    );
    await fixtures.pool.query('delete from moderation_queue_items where server_id=$1', [id.guild]);
    if (empty)
      await fixtures.pool.query("update report_intakes set status='actioned' where server_id=$1", [
        id.guild,
      ]);
    else
      await fixtures.pool.query(
        "insert into verification_events(id,server_id,user_id,status) values('91000000-0000-4000-8000-000000000032',$1,$2,'pending')",
        [id.guild, id.reporter]
      );
    await page.goto(`/admin/guild/${id.guild}/cases`);
    await expect(page).toHaveURL(new RegExp(`/inbox`));
    const assertListing = async () => {
      const parked = page.getByRole('region', { name: 'Parked recovery' });
      await expect(parked.getByRole('link', { name: /Case member/ })).toBeVisible();
      await expect(parked).toContainText('Parked');
      await expect(parked.locator('time')).toHaveAttribute('datetime', '2026-10-25T12:00:00.000Z');
      await expect(page.locator(`[data-inbox-item="case:${id.case}"]`)).toHaveCount(0);
      await expect(page.locator(`a[href*="${foreignCase}"]`)).toHaveCount(0);
      await expect(page).not.toHaveURL(new RegExp(`selected=case%3A${id.case}`));
      if (empty) {
        await expect(
          page.getByText('No inbox items match these filters.', { exact: true })
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Inbox 0', exact: true })).toBeVisible();
      } else
        await expect(page.getByRole('heading', { name: 'Inbox 1', exact: true })).toBeVisible();
    };
    await assertListing();
    await page.screenshot({ path: testInfo.outputPath('parked-recovery.png'), fullPage: true });
    await page
      .getByRole('region', { name: 'Parked recovery' })
      .getByRole('link', { name: /Case member/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/cases/${id.case}`));
    await expect(
      page.getByRole('region', { name: 'Account containment and recovery' })
    ).toContainText('Parked');
    await page
      .getByRole('link', { name: /Back to inbox/ })
      .first()
      .click();
    await assertListing();
    await page.reload();
    await assertListing();
  });

test('empty inbox return focuses after the queue commits even when a frame runs before that commit', async ({
  page,
}, testInfo) => {
  const focusEvents: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('queue-focus:')) focusEvents.push(message.text());
  });
  await page.addInitScript(() => {
    const restoring = new URL(window.location.href).searchParams.has('resume');
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const queue = document.querySelector('[aria-label="Inbox queue"]');
      // Exercise the legal ordering where a frame callback precedes React's next commit.
      if (restoring && queue && getComputedStyle(queue).display === 'none') {
        queueMicrotask(() => callback(performance.now()));
        return 0;
      }
      return requestFrame(callback);
    };
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (options) {
      const queue = this.closest('[aria-label="Inbox queue"]');
      if (queue)
        console.log(
          `queue-focus:${JSON.stringify({ target: this.tagName, display: getComputedStyle(queue).display })}`
        );
      focus.call(this, options);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/guild/${id.guild}/inbox?kind=case&selected=case:${id.case}`);
  await expect(page.getByRole('region', { name: 'Selected inbox item' })).toBeFocused();
  await page.getByRole('link', { name: 'Open case', exact: true }).click();
  await fixtures.pool.query(
    "update verification_events set status='verified',resolved_at=now() where id=$1",
    [id.case]
  );
  await page
    .getByRole('link', { name: /Back to inbox/ })
    .first()
    .click();
  try {
    await expect(page.getByRole('heading', { name: 'Inbox 0', exact: true })).toBeFocused();
  } finally {
    await testInfo.attach('queue-focus-events', {
      body: JSON.stringify(focusEvents),
      contentType: 'application/json',
    });
  }
});
