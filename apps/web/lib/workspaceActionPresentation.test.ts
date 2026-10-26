import { describe, expect, it } from 'vitest';
import { deriveWorkspaceActionPresentation } from './workspaceActionPresentation';
import type { WorkspaceMutationResult } from './workspaceActionTypes';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
const request: ModerationActionRequestSummary = {
  id: 'request-1',
  actionType: 'ban_observed_detection',
  actorSurface: 'web',
  completedAt: null,
  detectionEventId: 'detection-1',
  failedAt: null,
  lastError: null,
  messageDeletionJobId: null,
  requestedAt: '2026-10-25T00:00:00Z',
  reportIntakeId: null,
  requestedAction: 'ban_user',
  resultSummary: null,
  status: 'processing',
  targetUserId: 'member-1',
  updatedAt: '2026-10-25T00:00:00Z',
  verificationEventId: null,
};
const input = { localResult: null, durableRequest: null, cleanupJob: null, record: null };
describe('workspace action presentation', () => {
  it('makes no execution-stage claim for an ordinary failed response', () => {
    const genericFailure = {
      ...input,
      localResult: {
        kind: 'failed',
        message: 'Response unavailable',
      } satisfies WorkspaceMutationResult,
    };
    expect(deriveWorkspaceActionPresentation(genericFailure).kind).toBe('failed_uncertain');
    expect(deriveWorkspaceActionPresentation(genericFailure).message).not.toContain('Not sent');
  });
  it('only presents unknown ban outcome from an explicit durable field', () => {
    const explicitUnknownBan = {
      ...input,
      durableRequest: {
        ...request,
        observedBanResult: { status: 'ban_outcome_unknown', operationId: 'operation-1' } as const,
      },
    };
    expect(deriveWorkspaceActionPresentation(explicitUnknownBan).kind).toBe('ban_outcome_unknown');
    expect(deriveWorkspaceActionPresentation({ ...input, durableRequest: request }).kind).toBe(
      'pending'
    );
  });
  it('separates confirmed ban with pending updates', () => {
    const confirmedBanPendingUpdates = {
      ...input,
      durableRequest: {
        ...request,
        observedBanResult: {
          status: 'banned_updates_pending',
          operationId: 'operation-1',
        } as const,
      },
    };
    expect(deriveWorkspaceActionPresentation(confirmedBanPendingUpdates).kind).toBe(
      'banned_updates_pending'
    );
  });
  it('does not infer a refreshed membership outcome from generic request completion', () => {
    expect(
      deriveWorkspaceActionPresentation({
        ...input,
        durableRequest: { ...request, status: 'completed' },
      })
    ).toMatchObject({ kind: 'completed', message: 'Request completed.' });
  });
  it('retains a report closure cleanup warning without reopening the report', () => {
    expect(
      deriveWorkspaceActionPresentation({
        ...input,
        localResult: {
          kind: 'report_closure',
          result: {
            actor: { id: 'moderator-1', surface: 'web' },
            action: 'dismiss_no_action',
            reportId: 'report-1',
            reportStatus: 'dismissed',
            status: 'closed',
            queueCleanupStatus: 'failed',
          },
        },
      })
    ).toMatchObject({
      kind: 'completed',
      message: 'Report dismissed. Queue notification cleanup failed.',
    });
  });
  it.each(['already_handled', 'busy'] as const)(
    'does not claim dismissal from requested status when closure is %s',
    (status) => {
      const presentation = deriveWorkspaceActionPresentation({
        ...input,
        localResult: {
          kind: 'report_closure',
          result: {
            actor: { id: 'moderator-1', surface: 'web' },
            action: 'dismiss_no_action',
            reportId: 'report-1',
            reportStatus: 'dismissed',
            status,
            queueCleanupStatus: 'skipped',
          },
        },
      });
      expect(presentation.kind).toBe('blocked');
      expect(presentation.message).not.toContain('Report dismissed.');
      expect(presentation.message).toContain('Refresh');
    }
  );
});

import { fixtureMessageCleanupJobDetails } from './messageCleanupFixtures';
it('only offers cleanup finalization retry from the actual completed combined job', () => {
  const job = {
    ...fixtureMessageCleanupJobDetails[0],
    mode: 'ban_with_cleanup',
    status: 'completed',
    banStatus: 'succeeded',
    caseFinalizationStatus: 'failed',
  } as const;
  expect(deriveWorkspaceActionPresentation({ ...input, cleanupJob: job }).kind).toBe(
    'finalization_retry'
  );
  expect(
    deriveWorkspaceActionPresentation({ ...input, cleanupJob: { ...job, banStatus: 'pending' } })
      .kind
  ).toBe('idle');
});

it('states confirmed ban only when the durable adapter explicitly records it', () => {
  expect(
    deriveWorkspaceActionPresentation({
      ...input,
      durableRequest: { ...request, status: 'completed', observedBanResult: { status: 'banned' } },
    })
  ).toMatchObject({ kind: 'completed', message: 'Member banned.' });
});

it('preserves an actual processing receipt before or between durable snapshots', () => {
  expect(
    deriveWorkspaceActionPresentation({
      ...input,
      localResult: { kind: 'request', receipt: { id: 'request-1', status: 'processing' } },
    })
  ).toMatchObject({ kind: 'pending', message: 'Request processing.' });
});
it('keeps a queued finalization retry pending while the prior job result remains failed', async () => {
  const { fixtureMessageCleanupJobDetails } = await import('./messageCleanupFixtures');
  const result = deriveWorkspaceActionPresentation({
    ...input,
    cleanupJob: fixtureMessageCleanupJobDetails[1],
    localResult: { kind: 'request', receipt: { id: 'retry', status: 'queued' } },
  });
  expect(result.kind).toBe('pending');
});

it.each(['ban_outcome_unknown', 'banned_updates_pending', 'banned'] as const)(
  'keeps durable ban %s ahead of active cleanup and local failures',
  (status) => {
    expect(
      deriveWorkspaceActionPresentation({
        ...input,
        cleanupJob: fixtureMessageCleanupJobDetails[1],
        localResult: { kind: 'failed', message: 'Local failure' },
        durableRequest: {
          ...request,
          observedBanResult:
            status === 'banned' ? { status } : { status, operationId: 'operation' },
        },
      }).kind
    ).toBe(status === 'banned' ? 'completed' : status);
  }
);
it.each(['queued', 'processing'] as const)(
  'keeps durable %s ahead of finalization retry and local failure',
  (status) => {
    expect(
      deriveWorkspaceActionPresentation({
        ...input,
        cleanupJob: fixtureMessageCleanupJobDetails[1],
        localResult: { kind: 'failed', message: 'Local failure' },
        durableRequest: { ...request, status },
      })
    ).toEqual({
      kind: 'pending',
      message: status === 'queued' ? 'Request queued.' : 'Request processing.',
    });
  }
);
it('keeps failed finalization ahead of an inactive durable failure', () => {
  expect(
    deriveWorkspaceActionPresentation({
      ...input,
      cleanupJob: fixtureMessageCleanupJobDetails[1],
      durableRequest: { ...request, status: 'failed', lastError: 'Request failure' },
    }).kind
  ).toBe('finalization_retry');
});
it('keeps actual durable failure ahead of local success', () => {
  expect(
    deriveWorkspaceActionPresentation({
      ...input,
      durableRequest: { ...request, status: 'failed', lastError: 'Actual failure' },
      localResult: { kind: 'request', receipt: { id: request.id, status: 'completed' } },
    })
  ).toEqual({ kind: 'failed_uncertain', message: 'Actual failure' });
});
