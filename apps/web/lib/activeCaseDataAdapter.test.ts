import { describe, expect, it } from 'vitest';
import {
  buildCaseActionIdempotencyKey,
  FixtureActiveCaseDataAdapter,
  parseCaseSummaryRow,
  resolveCaseActionQueueStatus,
  resolveReportIntakeId,
} from './activeCaseDataAdapter';

const baseRow = {
  id: 'ver-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: 'det-1',
  thread_id: 'thread-1',
  private_evidence_thread_id: 'evidence-thread-1',
  notification_channel_id: 'notification-channel-1',
  notification_message_id: 'admin-message-1',
  status: 'pending',
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  notes: null,
  metadata: {
    source_channel_id: 'source-channel-1',
    source_message_id: 'source-message-1',
  },
  admin_channel_id: 'admin-channel-1',
  latest_detection_type: 'gpt_analysis',
  latest_confidence: 0.91,
  latest_detection_at: new Date('2026-06-01T00:00:00.000Z'),
  latest_detection_metadata: {},
  source_channel_id: null,
  source_message_id: null,
  last_action_type: null,
  last_action_at: null,
  latest_outcome_type: null,
  latest_outcome_source: null,
  user_username: 'stored-username',
  user_metadata: {},
  member_user_id: 'user-1',
};

describe('activeCaseDataAdapter', () => {
  it('binds account-quarantine execution idempotency to its completed preview', () => {
    const base = {
      action: 'quarantine_compromised_account' as const,
      adminId: 'moderator-1',
      attemptId: 'attempt-1',
      caseId: 'ver-1',
      guildId: 'guild-1',
      quarantinePhase: 'preview' as const,
    };

    expect(buildCaseActionIdempotencyKey(base)).toBe(
      'web:case-action:quarantine_compromised_account:guild-1:ver-1:preview:attempt-1'
    );
    expect(
      buildCaseActionIdempotencyKey({
        ...base,
        quarantinePhase: 'execute',
        previewRequestId: 'preview-1',
      })
    ).toBe('web:case-action:quarantine_compromised_account:guild-1:ver-1:execute:preview-1');
  });

  it('uses a fresh idempotency key for each repeatable CAPTCHA action', () => {
    const base = {
      adminId: 'moderator-1',
      attemptId: 'attempt-2',
      caseId: 'ver-1',
      guildId: 'guild-1',
    };

    expect(buildCaseActionIdempotencyKey({ ...base, action: 'retry_captcha' })).toBe(
      'web:case-action:retry_captcha:guild-1:ver-1:attempt-2'
    );
    expect(buildCaseActionIdempotencyKey({ ...base, action: 'bypass_captcha' })).toBe(
      'web:case-action:bypass_captcha:guild-1:ver-1:attempt-2'
    );
  });

  it('preserves failed queue receipts for inline action feedback', () => {
    expect(resolveCaseActionQueueStatus('queued')).toBe('queued');
    expect(resolveCaseActionQueueStatus('processing')).toBe('queued');
    expect(resolveCaseActionQueueStatus('completed')).toBe('already_handled');
    expect(resolveCaseActionQueueStatus('failed')).toBe('failed');
  });

  it('parses pending case summary rows with surface links and stale state', () => {
    const summary = parseCaseSummaryRow(baseRow, new Date('2026-06-03T01:00:00.000Z'));

    expect(summary).toEqual(
      expect.objectContaining({
        id: 'ver-1',
        guildId: 'guild-1',
        userId: 'user-1',
        userIdentity: expect.objectContaining({
          displayLabel: 'stored-username',
          username: 'stored-username',
          id: 'user-1',
        }),
        stale: true,
        staleHours: 25,
        presenceState: 'in_server',
        confidence: 0.91,
        latestDetectionType: 'gpt_analysis',
        allowedActions: [
          'view_history',
          'verify_user',
          'kick_user',
          'ban_user',
          'close_no_action',
          'refresh_notification',
          'repair_thread',
        ],
      })
    );
    expect(summary.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'admin_notification',
          url: 'https://discord.com/channels/guild-1/notification-channel-1/admin-message-1',
          desktopUrl:
            'discord://discord.com/channels/guild-1/notification-channel-1/admin-message-1',
        }),
        expect.objectContaining({
          kind: 'source_message',
          url: 'https://discord.com/channels/guild-1/source-channel-1/source-message-1',
          desktopUrl: 'discord://discord.com/channels/guild-1/source-channel-1/source-message-1',
        }),
      ])
    );
  });

  it('offers account quarantine only when the server feature is enabled', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, server_settings: { account_quarantine_enabled: true } },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toContain('quarantine_compromised_account');
  });

  it('offers a moderator challenge only when browser checks are enabled and unused', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, server_settings: { captcha_mode: 'manual' } },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toContain('challenge_user');
    expect(summary.captchaChallenge).toBeNull();
  });

  it('maps a pending challenge and replaces challenge with bypass', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        server_settings: { captcha_mode: 'suspicious_join' },
        captcha_status: 'pending',
        captcha_request_source: 'automatic_suspicious_join',
        captcha_pass_effect: 'verify_join_only',
        captcha_generation: 1,
        captcha_submission_count: 2,
        captcha_expires_at: new Date('2026-06-04T00:00:00.000Z'),
        captcha_requested_at: new Date('2026-06-03T00:00:00.000Z'),
        captcha_delivered_at: new Date('2026-06-03T00:01:00.000Z'),
        captcha_delivery_error_code: null,
        captcha_passed_at: null,
        captcha_bypassed_at: null,
        captcha_bypassed_by: null,
        captcha_bypass_reason: null,
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.captchaChallenge).toEqual(
      expect.objectContaining({ status: 'pending', submissionCount: 2, generation: 1 })
    );
    expect(summary.allowedActions).toContain('bypass_captcha');
    expect(summary.allowedActions).not.toContain('challenge_user');
  });

  it('offers immediate retry when a pending challenge was not delivered', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        server_settings: { captcha_mode: 'manual' },
        captcha_status: 'pending',
        captcha_request_source: 'moderator',
        captcha_pass_effect: 'evidence_only',
        captcha_generation: 1,
        captcha_submission_count: 0,
        captcha_expires_at: new Date('2026-06-04T00:00:00.000Z'),
        captcha_requested_at: new Date('2026-06-03T00:00:00.000Z'),
        captcha_delivered_at: null,
        captcha_delivery_error_code: 'discord_delivery_failed',
        captcha_passed_at: null,
        captcha_bypassed_at: null,
        captcha_bypassed_by: null,
        captcha_bypass_reason: null,
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toContain('retry_captcha');
    expect(summary.allowedActions).toContain('bypass_captcha');
  });

  it('never offers another challenge after a pass', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        server_settings: { captcha_mode: 'manual' },
        captcha_status: 'passed',
        captcha_request_source: 'moderator',
        captcha_pass_effect: 'evidence_only',
        captcha_generation: 1,
        captcha_submission_count: 1,
        captcha_expires_at: new Date('2026-06-04T00:00:00.000Z'),
        captcha_requested_at: new Date('2026-06-03T00:00:00.000Z'),
        captcha_delivered_at: new Date('2026-06-03T00:01:00.000Z'),
        captcha_delivery_error_code: null,
        captcha_passed_at: new Date('2026-06-03T00:02:00.000Z'),
        captcha_bypassed_at: null,
        captcha_bypassed_by: null,
        captcha_bypass_reason: null,
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).not.toContain('challenge_user');
    expect(summary.allowedActions).not.toContain('retry_captcha');
    expect(summary.allowedActions).not.toContain('bypass_captcha');
  });

  it.each(['failed', 'expired'] as const)(
    'offers retry or bypass when a challenge is %s',
    (captchaStatus) => {
      const summary = parseCaseSummaryRow(
        {
          ...baseRow,
          server_settings: { captcha_mode: 'manual' },
          captcha_status: captchaStatus,
          captcha_request_source: 'moderator',
          captcha_pass_effect: 'evidence_only',
          captcha_generation: 1,
          captcha_submission_count: 5,
          captcha_expires_at: new Date('2026-06-04T00:00:00.000Z'),
          captcha_requested_at: new Date('2026-06-03T00:00:00.000Z'),
          captcha_delivered_at: new Date('2026-06-03T00:01:00.000Z'),
          captcha_delivery_error_code: null,
          captcha_passed_at: null,
          captcha_bypassed_at: null,
          captcha_bypassed_by: null,
          captcha_bypass_reason: null,
        },
        new Date('2026-06-03T01:00:00.000Z')
      );

      expect(summary.allowedActions).toContain('retry_captcha');
      expect(summary.allowedActions).toContain('bypass_captcha');
    }
  );

  it('parses parked quarantine effects and keeps the case outside normal review actions', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        case_kind: 'compromised_account',
        attention_state: 'parked',
        containment_status: 'contained',
        parked_at: new Date('2026-06-02T12:00:00.000Z'),
        parked_by: 'moderator-1',
        server_settings: { account_quarantine_enabled: true },
        metadata: {
          account_quarantine: {
            removed_role_ids: ['role-1', 'role-2'],
            retained_roles: [{ role_id: 'managed-role' }],
            failed_removals: [],
            member_bypasses: [],
          },
        },
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary).toEqual(
      expect.objectContaining({
        caseKind: 'compromised_account',
        attentionState: 'parked',
        containmentStatus: 'contained',
        parkedBy: 'moderator-1',
        quarantineEffects: {
          removedRoleCount: 2,
          retainedRoleCount: 1,
          failedRoleCount: 0,
          memberBypassCount: 0,
        },
      })
    );
    expect(summary.allowedActions).toEqual([
      'view_history',
      'verify_user',
      'kick_user',
      'ban_user',
      'refresh_notification',
    ]);
  });

  it('does not expose close-no-action when a parked user has left the server', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        case_kind: 'compromised_account',
        attention_state: 'parked',
        containment_status: 'contained',
        latest_outcome_type: 'member_left',
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('left_or_removed');
    expect(summary.allowedActions).toEqual(['view_history', 'ban_by_id', 'refresh_notification']);
  });

  it('does not expose close-no-action for an incomplete compromised quarantine', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        case_kind: 'compromised_account',
        attention_state: 'review_required',
        containment_status: 'incomplete',
        server_settings: { account_quarantine_enabled: true },
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).not.toContain('close_no_action');
    expect(summary.allowedActions).toEqual(
      expect.arrayContaining([
        'verify_user',
        'kick_user',
        'ban_user',
        'quarantine_compromised_account',
        'repair_thread',
      ])
    );
  });

  it('does not expose close-no-action when an incomplete quarantined user has left', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        case_kind: 'compromised_account',
        attention_state: 'review_required',
        containment_status: 'incomplete',
        latest_outcome_type: 'member_left',
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toEqual(['view_history', 'ban_by_id', 'refresh_notification']);
  });

  it('falls back to the admin channel when notification channel is missing', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, notification_channel_id: null },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'admin_notification',
          url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1',
        }),
      ])
    );
  });

  it('prefers snapshot identity over stored username', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        metadata: {
          user_snapshot: {
            username: 'snapshot-username',
            global_name: 'Snapshot Global',
            nickname: 'Snapshot Nick',
            display_name: 'Server Effective Name',
            avatar_url: 'https://cdn.discordapp.com/embed/avatars/3.png',
          },
        },
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.userIdentity).toEqual({
      id: 'user-1',
      username: 'snapshot-username',
      globalName: 'Snapshot Global',
      nickname: 'Snapshot Nick',
      displayName: 'Server Effective Name',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
      displayLabel: 'Server Effective Name',
    });
  });

  it('marks cases without current membership evidence as unknown', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, member_user_id: null },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('unknown');
    expect(summary.allowedActions).toEqual([
      'view_history',
      'ban_by_id',
      'close_no_action',
      'refresh_notification',
    ]);
  });

  it('marks departed users with ban-by-id and close actions', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        metadata: { membership_state: 'left_or_removed' },
        latest_outcome_type: 'member_left',
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('left_or_removed');
    expect(summary.allowedActions).toEqual([
      'view_history',
      'ban_by_id',
      'close_no_action',
      'refresh_notification',
    ]);
  });

  it('marks externally banned users with sync action', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, latest_outcome_type: 'banned' },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('banned');
    expect(summary.allowedActions).toEqual([
      'view_history',
      'sync_existing_ban',
      'refresh_notification',
    ]);
  });

  it('keeps externally banned resolved rows read-only', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, latest_outcome_type: 'banned', status: 'banned' },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('banned');
    expect(summary.allowedActions).toEqual(['view_history', 'refresh_notification']);
  });

  it('exposes reopen for resolved cases when the member is still in server', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, status: 'verified' },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('in_server');
    expect(summary.allowedActions).toEqual(['view_history', 'reopen_case', 'refresh_notification']);
  });

  it('does not expose refresh when a case has no stored notification message', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, notification_message_id: null },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toEqual([
      'view_history',
      'verify_user',
      'kick_user',
      'ban_user',
      'close_no_action',
      'repair_thread',
    ]);
  });

  it('keeps report evidence tied to the opening detection metadata', () => {
    expect(
      resolveReportIntakeId(
        { reportIntakeId: 'opening-intake' },
        { reportIntakeId: 'latest-intake' }
      )
    ).toBe('opening-intake');
    expect(resolveReportIntakeId({}, { reportIntakeId: 'latest-intake' })).toBe('latest-intake');
    expect(resolveReportIntakeId({}, {})).toBeNull();
  });

  it('queues fixture case actions only when the action is allowed', async () => {
    const adapter = new FixtureActiveCaseDataAdapter();

    await expect(
      adapter.queueCaseAction({
        action: 'repair_thread',
        adminId: 'admin-1',
        caseId: 'case-stale',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'repair_thread',
      caseId: 'case-stale',
      requestId: 'fixture-case-action-repair_thread-case-stale',
      status: 'queued',
    });
    await expect(
      adapter.queueCaseAction({
        action: 'refresh_notification',
        adminId: 'admin-1',
        caseId: 'case-stale',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'refresh_notification',
      caseId: 'case-stale',
      requestId: 'fixture-case-action-refresh_notification-case-stale',
      status: 'queued',
    });
    await expect(
      adapter.queueCaseAction({
        action: 'verify_user',
        adminId: 'admin-1',
        caseId: 'case-left',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'verify_user',
      caseId: 'case-left',
      requestId: null,
      status: 'not_allowed',
    });
    await expect(
      adapter.queueCaseAction({
        action: 'sync_existing_ban',
        adminId: 'admin-1',
        caseId: 'case-banned',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'sync_existing_ban',
      caseId: 'case-banned',
      requestId: 'fixture-case-action-sync_existing_ban-case-banned',
      status: 'queued',
    });
  });

  it('lists resolved fixture cases newest first with read-only actions', async () => {
    const adapter = new FixtureActiveCaseDataAdapter();

    await expect(adapter.listResolvedCases('guild-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'case-resolved-ban',
        allowedActions: ['view_history', 'refresh_notification'],
      }),
      expect.objectContaining({
        id: 'case-resolved-verified',
        allowedActions: ['view_history', 'reopen_case'],
      }),
    ]);
  });

  it('provides a representative parked fixture outside the review queue', async () => {
    const adapter = new FixtureActiveCaseDataAdapter();

    await expect(adapter.listParkedCases()).resolves.toEqual([
      expect.objectContaining({
        attentionState: 'parked',
        caseKind: 'compromised_account',
        containmentStatus: 'contained',
      }),
    ]);
  });
});

describe('activeCaseDataAdapter CAPTCHA recovery actions', () => {
  it('offers retry after a cancelled challenge is reopened with the case', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        server_settings: { captcha_mode: 'manual' },
        captcha_status: 'cancelled',
        captcha_request_source: 'moderator',
        captcha_pass_effect: 'evidence_only',
        captcha_generation: 1,
        captcha_submission_count: 0,
        captcha_expires_at: new Date('2026-06-04T00:00:00.000Z'),
        captcha_requested_at: new Date('2026-06-03T00:00:00.000Z'),
        captcha_delivery_error_code: null,
        captcha_bypassed_by: null,
        captcha_bypass_reason: null,
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toContain('retry_captcha');
  });

  it('does not offer CAPTCHA issuance or retry when the case subject is absent', () => {
    const unused = parseCaseSummaryRow(
      {
        ...baseRow,
        member_user_id: null,
        server_settings: { captcha_mode: 'manual' },
      },
      new Date('2026-06-03T01:00:00.000Z')
    );
    const failed = parseCaseSummaryRow(
      {
        ...baseRow,
        member_user_id: null,
        server_settings: { captcha_mode: 'manual' },
        captcha_status: 'failed',
        captcha_request_source: 'moderator',
        captcha_pass_effect: 'evidence_only',
        captcha_generation: 1,
        captcha_submission_count: 5,
        captcha_expires_at: new Date('2026-06-04T00:00:00.000Z'),
        captcha_requested_at: new Date('2026-06-03T00:00:00.000Z'),
        captcha_delivery_error_code: null,
        captcha_bypassed_by: null,
        captcha_bypass_reason: null,
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(unused.allowedActions).not.toContain('challenge_user');
    expect(failed.allowedActions).not.toContain('retry_captcha');
    expect(failed.allowedActions).toContain('bypass_captcha');
  });
});
