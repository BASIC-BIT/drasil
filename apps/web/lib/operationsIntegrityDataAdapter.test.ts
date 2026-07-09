import { describe, expect, it } from 'vitest';
import { buildOperationsIntegritySnapshot } from './operationsIntegrityDataAdapter';

describe('operationsIntegrityDataAdapter', () => {
  it('builds a deterministic integrity snapshot from count and finding rows', () => {
    expect(
      buildOperationsIntegritySnapshot(
        new Date('2026-06-08T01:16:02.000Z'),
        {
          pending_cases: '2',
          recent_resolved_cases: '4',
          case_role_members: 1,
          active_role_quarantines: '0',
          queue_items: '5',
        },
        [
          {
            severity: 'error',
            code: 'resolved_case_missing_admin_action',
            subject: 'case case-1',
            detail: 'Resolved case has no matching durable admin action row.',
            user_id: 'user-1',
            verification_event_id: 'case-1',
          },
          {
            severity: 'warning',
            code: 'queue_item_missing_message_pointer',
            subject: 'queue item queue-1',
            detail: 'Queue item does not have both queue_channel_id and queue_message_id recorded.',
            user_id: 'user-2',
            verification_event_id: null,
          },
        ]
      )
    ).toEqual({
      checkedAt: '2026-06-08T01:16:02.000Z',
      lookbackDays: 30,
      candidateCounts: {
        pendingCases: 2,
        recentResolvedCases: 4,
        caseRoleMembers: 1,
        activeRoleQuarantines: 0,
        queueItems: 5,
      },
      findingCounts: {
        error: 1,
        warning: 1,
        info: 0,
      },
      findings: [
        {
          severity: 'error',
          code: 'resolved_case_missing_admin_action',
          subject: 'case case-1',
          detail: 'Resolved case has no matching durable admin action row.',
          userId: 'user-1',
          verificationEventId: 'case-1',
        },
        {
          severity: 'warning',
          code: 'queue_item_missing_message_pointer',
          subject: 'queue item queue-1',
          detail: 'Queue item does not have both queue_channel_id and queue_message_id recorded.',
          userId: 'user-2',
          verificationEventId: null,
        },
      ],
      liveDiscordChecksAvailableInDiscord: true,
    });
  });
});
