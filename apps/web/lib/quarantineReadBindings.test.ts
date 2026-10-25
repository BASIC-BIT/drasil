import { expect, it } from 'vitest';
import { parseModerationActionRequestRow } from './moderationActionRequestDataAdapter';
it('preserves actual preview ownership and full recorded blockers without exposing the fingerprint', () => {
  const result = parseModerationActionRequestRow({
    id: 'preview',
    action_type: 'preview_account_quarantine',
    actor_id: 'moderator',
    actor_surface: 'web',
    completed_at: '2026-10-25T12:00:00Z',
    failed_at: null,
    last_error: null,
    requested_at: '2026-10-25T11:59:59Z',
    updated_at: '2026-10-25T12:00:00Z',
    target_user_id: 'member',
    verification_event_id: 'case',
    status: 'completed',
    result: {
      action_type: 'preview_account_quarantine',
      containment_fingerprint: 'private',
      lockdown_issues: [
        { code: 'blocked', message: 'A complete blocker description', severity: 'error' },
      ],
      member_bypasses: [
        {
          channel_id: 'channel',
          channel_name: 'general',
          permissions: ['SendMessages'],
          subject_id: 'member',
          subject_type: 'member',
        },
      ],
    },
  });
  expect(result.actorUserId).toBe('moderator');
  expect(result.accountQuarantinePreview).toMatchObject({
    lockdownIssues: [
      { code: 'blocked', message: 'A complete blocker description', severity: 'error' },
    ],
    memberBypasses: [
      {
        channelId: 'channel',
        channelName: 'general',
        permissions: ['SendMessages'],
        subjectId: 'member',
        subjectType: 'member',
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain('private');
});
