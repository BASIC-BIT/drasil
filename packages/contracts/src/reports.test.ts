import { describe, expect, it } from 'vitest';
import {
  projectReportEvidenceSource,
  reportDetailSchema,
  sortReportQueueItems,
  type ReportQueueItem,
} from './reports';

const baseReport: ReportQueueItem = {
  id: 'report-1',
  guildId: 'guild-1',
  reporterId: 'reporter-1',
  targetUserId: 'user-1',
  status: 'submitted',
  summary: null,
  summarySource: 'other',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  stale: false,
  staleHours: 1,
  evidenceCount: 0,
  reportThreadUrl: null,
  latestDetectionId: null,
  latestCaseId: null,
  allowedActions: ['mark_actioned', 'dismiss_no_action', 'mark_false_positive'],
};

describe('report contracts', () => {
  it('sorts stale reports before fresh reports, then oldest movement first', () => {
    const reports = sortReportQueueItems([
      { ...baseReport, id: 'fresh-old', updatedAt: '2026-06-01T00:00:00.000Z' },
      { ...baseReport, id: 'stale-new', stale: true, updatedAt: '2026-06-03T00:00:00.000Z' },
      { ...baseReport, id: 'stale-old', stale: true, updatedAt: '2026-06-02T00:00:00.000Z' },
    ]);

    expect(reports.map((report) => report.id)).toEqual(['stale-old', 'stale-new', 'fresh-old']);
  });

  it('parses report detail evidence and attachment metadata', () => {
    expect(
      reportDetailSchema.parse({
        ...baseReport,
        closedAt: null,
        evidence: [
          {
            id: 'evidence-1',
            kind: 'screenshot',
            content: null,
            createdAt: '2026-06-01T00:01:00.000Z',
            sourceMessageUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
            attachment: {
              id: 'attachment-1',
              name: 'proof.png',
              url: 'https://cdn.discordapp.com/attachments/proof.png',
              contentType: 'image/png',
              size: 12345,
            },
          },
        ],
      })
    ).toMatchObject({
      id: 'report-1',
      evidence: [expect.objectContaining({ kind: 'screenshot' })],
    });
  });
});

import { reportIntakeStatusSchema, reportAttentionRecordSchema } from './reports';
it('keeps all intake stages separate from reviewed report status', () => {
  expect(reportIntakeStatusSchema.options).toHaveLength(9);
  expect(reportIntakeStatusSchema.parse('collecting_evidence')).toBe('collecting_evidence');
  expect(reportAttentionRecordSchema.shape.status.safeParse('closed_by_reporter').success).toBe(
    true
  );
});
it('sorts reports with unknown update dates last', () => {
  expect(
    sortReportQueueItems([
      { ...baseReport, id: 'unknown', updatedAt: null },
      { ...baseReport, id: 'known' },
    ]).map((item) => item.id)
  ).toEqual(['known', 'unknown']);
});

import { projectReportIdentityReview, reportIdentityReviewSchema } from './reports';
const reviewMetadata = (
  handoff: Record<string, unknown>
): { analysis: Record<string, unknown>; quarantined_metadata: Record<string, unknown> } => ({
  analysis: {
    schemaVersion: 1,
    sources: {},
    outcome: null,
    coverage: null,
    requestReservations: [],
    handoff,
  },
  quarantined_metadata: { private: 'RAW_PROVIDER' },
});
it.each(['pending', 'delivered', 'acknowledged', 'resolved'] as const)(
  'projects %s independently from delivery and receipt',
  (state) => {
    const review = projectReportIdentityReview({
      status: 'needs_admin_confirmation',
      evidenceRevision: 3,
      metadata: reviewMetadata({
        state,
        reason: 'no_match',
        attempts: 1,
        nextDueAt: '2026-11-03T01:00:00.000Z',
        receipt: 'sent',
        ...(state === 'delivered' ? { messageId: 'message', channelId: 'channel' } : {}),
        ...(state === 'acknowledged'
          ? { acknowledgedBy: 'staff', acknowledgedAt: '2026-11-03T00:00:00.000Z' }
          : {}),
        ...(state === 'resolved'
          ? { resolvedBy: 'staff', resolvedAt: '2026-11-03T00:00:00.000Z' }
          : {}),
      }),
    });
    expect(review).toMatchObject({
      phase: state,
      receipt: 'sent',
      evidenceRevision: 3,
      delivery: state === 'delivered' ? 'delivered' : state === 'pending' ? 'pending' : 'unknown',
      deliveredAt: null,
      candidateCount: null,
      coverageKind: null,
    });
    expect(reportIdentityReviewSchema.parse(review)).toEqual(review);
    expect(JSON.stringify(review)).not.toMatch(/RAW_PROVIDER|quarantined/);
  }
);
it('keeps missing or invalid analysis unknown', () => {
  expect(
    projectReportIdentityReview({
      status: 'needs_admin_confirmation',
      metadata: { analysis: { bad: true } },
    })
  ).toMatchObject({
    phase: 'pending',
    reason: null,
    candidateCount: null,
    delivery: 'unknown',
    receipt: 'unknown',
  });
});

import { reportIntakeStatusLabel } from './reports';
it('preserves the original reason while showing bounded updated candidates and their provenance', () => {
  const metadata = reviewMetadata({
    state: 'pending',
    reason: 'no_match',
    receipt: 'pending',
    attempts: 0,
    nextDueAt: '2026-11-03T00:00:00.000Z',
  });
  const candidates = Array.from({ length: 7 }, (_, i) => ({
    candidateId: `candidate-${i}`,
    discordUserId: `user-${i}`,
    serverId: 'guild',
    username: 'handle',
    globalName: 'Account name',
    nickname: 'Server nickname',
    displayName: 'Server nickname',
    avatarUrl: null,
    sourceRefs: [],
    matchedFields: ['nickname'],
    subjectMatches: [{ subjectId: 'subject', sourceRefs: [], matchedFields: ['nickname'] }],
    providerPayload: 'RAW',
  }));
  const view = projectReportIdentityReview({
    status: 'needs_admin_confirmation',
    metadata: {
      ...metadata,
      analysis: {
        ...metadata.analysis,
        coverage: { kind: 'not_required', reason: 'validated_anchor' },
        outcome: {
          kind: 'admin_review',
          reason: 'ambiguous',
          candidates,
          coverage: { kind: 'not_required', reason: 'validated_anchor' },
          includedEvidenceIds: [],
          excludedEvidenceIds: [],
        },
      },
    },
  });
  expect(view).toMatchObject({
    reason: 'no_match',
    candidateCount: 7,
    coverageKind: 'not_required',
  });
  expect(view?.candidates).toHaveLength(5);
  expect(view?.candidates[0]).toMatchObject({
    username: 'handle',
    globalName: 'Account name',
    nickname: 'Server nickname',
    subjectMatches: [{ subjectId: 'subject', matchedFields: ['nickname'] }],
  });
  expect(JSON.stringify(view)).not.toContain('RAW');
});
it('does not treat extra unvalidated pending fields as proof of delivery or acknowledgement', () => {
  const view = projectReportIdentityReview({
    status: 'needs_admin_confirmation',
    metadata: reviewMetadata({
      state: 'pending',
      reason: 'no_match',
      receipt: 'pending',
      attempts: 0,
      nextDueAt: '2026-11-03T00:00:00.000Z',
      messageId: 'unvalidated',
      channelId: 'unvalidated',
      acknowledgedAt: 'unvalidated',
    }),
  });
  expect(view).toMatchObject({ delivery: 'pending', acknowledgedAt: null });
});
it('distinguishes staff closure, reporter closure and unknown historical closure', () => {
  expect(reportIntakeStatusLabel('closed_by_reporter', { closed_by_staff: true })).toBe(
    'Resolved by staff'
  );
  expect(reportIntakeStatusLabel('closed_by_reporter', { closed_by: 'reporter' })).toBe(
    'Closed by reporter'
  );
  expect(reportIntakeStatusLabel('closed_by_reporter')).toBe('Closed');
  expect(
    reportIntakeStatusLabel('needs_admin_confirmation', { thread_closed_by_staff: true })
  ).toBe('Needs admin review');
});

it.each(['acknowledged', 'resolved'] as const)(
  'retains actual delivery proof after %s',
  (state) => {
    const view = projectReportIdentityReview({
      status: 'needs_admin_confirmation',
      metadata: reviewMetadata({
        state,
        reason: 'no_match',
        receipt: 'pending',
        attempts: 1,
        nextDueAt: null,
        messageId: 'message',
        channelId: 'channel',
        acknowledgedBy: 'staff',
        acknowledgedAt: '2026-11-03T00:00:00.000Z',
        ...(state === 'resolved'
          ? { resolvedBy: 'staff', resolvedAt: '2026-11-03T00:01:00.000Z' }
          : {}),
      }),
    });
    expect(view).toMatchObject({
      phase: state,
      delivery: 'delivered',
      deliveredAt: null,
      receipt: 'pending',
      acknowledgedBy: 'staff',
    });
  }
);

it.each([
  ['submitted', 'submitted'],
  ['actioned', 'actioned'],
  ['dismissed', 'dismissed'],
  ['false_positive', 'false positive'],
] as const)(
  'preserves %s report status after the identity review resolves',
  (status, expectedLabel) => {
    const metadata = reviewMetadata({
      state: 'resolved',
      reason: 'no_match',
      receipt: 'sent',
      attempts: 1,
      nextDueAt: null,
      resolvedBy: 'staff',
      resolvedAt: '2026-11-03T00:00:00.000Z',
    });
    const review = projectReportIdentityReview({ status, metadata });
    expect(review?.phase).toBe('resolved');
    expect(reportIntakeStatusLabel(status, metadata)).toBe(expectedLabel);
    expect(
      reportIntakeStatusLabel('closed_by_reporter', { ...metadata, closed_by: 'reporter' })
    ).toBe('Closed by reporter');
  }
);

it('projects bounded source history and keeps corrupt metadata unknown', () => {
  const input = {
    reportMetadata: {
      analysis: {
        schemaVersion: 1,
        sources: {
          message: {
            sourceVersion: 2,
            sourceFingerprint: 'private',
            sourceChannelId: 'thread',
            sourceAuthorId: 'author',
            observedAt: '2026-11-03T00:00:00.000Z',
            editedAt: null,
            operation: 'upsert',
            availability: 'unavailable',
          },
        },
        requestReservations: [],
        handoff: { state: 'none' },
        coverage: null,
        outcome: {
          kind: 'admin_review',
          reason: 'no_match',
          candidates: [],
          coverage: { kind: 'unavailable', reason: 'transport' },
          includedEvidenceIds: ['current'],
          excludedEvidenceIds: ['old'],
        },
      },
    },
    evidenceId: 'old',
    sourceMessageId: 'message',
    evidenceMetadata: { sourceVersion: 1 },
  };
  expect(projectReportEvidenceSource(input)).toEqual({
    sourceVersion: 1,
    currentSourceVersion: 2,
    sourceState: 'unavailable',
    versionState: 'superseded',
    analysisState: 'excluded',
  });
  expect(
    projectReportEvidenceSource({
      ...input,
      evidenceId: 'current',
      evidenceMetadata: { sourceVersion: 2 },
    })
  ).toMatchObject({ versionState: 'current', analysisState: 'analyzed' });
  expect(
    projectReportEvidenceSource({
      ...input,
      evidenceId: 'new',
      evidenceMetadata: { sourceVersion: 3 },
    })
  ).toMatchObject({ versionState: 'unknown', analysisState: 'not_analyzed' });
  expect(
    projectReportEvidenceSource({
      ...input,
      reportMetadata: { analysis: 'broken' },
      evidenceMetadata: {},
    })
  ).toMatchObject({ sourceVersion: null, sourceState: 'unknown', analysisState: 'unknown' });
});
