import { describe, expect, it } from 'vitest';
import {
  MESSAGE_CLEANUP_CONTENT_PREVIEW_MAX_LENGTH,
  MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT,
  MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT,
  getMessageCleanupExecutionEligibility,
  messageCleanupJobDetailSchema,
  messageCleanupJobSummarySchema,
  type MessageCleanupJobSummary,
} from './messageCleanup';

const buildJobSummary = (): MessageCleanupJobSummary => ({
  id: 'job-1',
  guildId: 'guild-1',
  verificationEventId: 'case-1',
  targetUserId: 'user-1',
  requestedBy: 'admin-1',
  actorSurface: 'web_case',
  mode: 'delete_only' as const,
  scope: 'last_day' as const,
  status: 'ready' as const,
  coverage: 'ready' as const,
  banStatus: 'not_requested' as const,
  caseFinalizationStatus: 'not_applicable' as const,
  reason: 'Remove messages confirmed during case review.',
  evidenceThreadUrl: 'https://discord.com/channels/guild-1/evidence-thread-1',
  requestedWindowStart: '2026-07-14T12:00:00.000Z',
  requestedWindowEnd: '2026-07-15T12:00:00.000Z',
  previewedAt: '2026-07-15T12:00:01.000Z',
  startedAt: null,
  completedAt: null,
  failedAt: null,
  createdAt: '2026-07-15T12:00:00.000Z',
  updatedAt: '2026-07-15T12:00:01.000Z',
  lastError: null,
  outcomes: {
    candidateCount: 2,
    preservedCount: 0,
    deletedCount: 0,
    alreadyMissingCount: 0,
    changedSincePreviewCount: 0,
    evidenceFailedCount: 0,
    deleteFailedCount: 0,
    permissionDeniedCount: 0,
  },
  execution: {
    canExecute: true,
    blockedReason: null,
    previewCandidateLimit: MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT,
    executionCandidateLimit: MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT,
  },
});

describe('message cleanup contracts', () => {
  it('validates durable job and item states from the Prisma model', () => {
    const detail = messageCleanupJobDetailSchema.parse({
      ...buildJobSummary(),
      items: [
        {
          id: 'item-1',
          messageId: 'message-1',
          channelId: 'channel-1',
          authorId: 'user-1',
          messageCreatedAt: '2026-07-15T11:30:00.000Z',
          messageEditedAt: null,
          contentPreview: 'Visit hxxps[:]//example.invalid',
          attachmentCount: 1,
          discoverySource: 'discord_search',
          bulkDeleteEligible: true,
          evidenceStatus: 'preserved',
          status: 'deleted',
          sourceMessageUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
          evidenceMessageUrl:
            'https://discord.com/channels/guild-1/evidence-thread-1/evidence-message-1',
          attemptedAt: '2026-07-15T12:02:00.000Z',
          evidencePreservedAt: '2026-07-15T12:02:01.000Z',
          deletedAt: '2026-07-15T12:02:02.000Z',
          completedAt: '2026-07-15T12:02:02.000Z',
          failureReason: null,
        },
      ],
    });

    expect(detail.items[0].status).toBe('deleted');
    expect(detail.items[0].evidenceStatus).toBe('preserved');
  });

  it('validates combined ban and case-finalization receipt states', () => {
    const summary = messageCleanupJobSummarySchema.parse({
      ...buildJobSummary(),
      mode: 'ban_with_cleanup',
      banStatus: 'succeeded',
      caseFinalizationStatus: 'failed',
    });

    expect(summary.banStatus).toBe('succeeded');
    expect(summary.caseFinalizationStatus).toBe('failed');
    expect(() =>
      messageCleanupJobSummarySchema.parse({ ...summary, banStatus: 'complete' })
    ).toThrow();
  });

  it('rejects previews and candidate counts above their durable bounds', () => {
    expect(() =>
      messageCleanupJobSummarySchema.parse({
        ...buildJobSummary(),
        outcomes: {
          ...buildJobSummary().outcomes,
          candidateCount: MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT + 1,
        },
      })
    ).toThrow();

    expect(() =>
      messageCleanupJobDetailSchema.parse({
        ...buildJobSummary(),
        items: [
          {
            id: 'item-1',
            messageId: 'message-1',
            channelId: 'channel-1',
            authorId: 'user-1',
            messageCreatedAt: '2026-07-15T11:30:00.000Z',
            messageEditedAt: null,
            contentPreview: 'x'.repeat(MESSAGE_CLEANUP_CONTENT_PREVIEW_MAX_LENGTH + 1),
            attachmentCount: 0,
            discoverySource: 'source_message',
            bulkDeleteEligible: false,
            evidenceStatus: 'pending',
            status: 'pending',
            sourceMessageUrl: null,
            evidenceMessageUrl: null,
            attemptedAt: null,
            evidencePreservedAt: null,
            deletedAt: null,
            completedAt: null,
            failureReason: null,
          },
        ],
      })
    ).toThrow();
  });

  it('blocks unsafe coverage and jobs above the execution cap', () => {
    expect(
      getMessageCleanupExecutionEligibility({
        mode: 'delete_only',
        status: 'ready',
        coverage: 'partial',
        scope: 'last_day',
        candidateCount: 20,
        banStatus: 'not_requested',
        caseFinalizationStatus: 'not_applicable',
      })
    ).toEqual(
      expect.objectContaining({
        canExecute: false,
        blockedReason: 'coverage_blocked',
      })
    );

    expect(
      getMessageCleanupExecutionEligibility({
        mode: 'delete_only',
        status: 'ready',
        coverage: 'ready',
        scope: 'last_7_days',
        candidateCount: MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT + 1,
        banStatus: 'not_requested',
        caseFinalizationStatus: 'not_applicable',
      })
    ).toEqual(
      expect.objectContaining({
        canExecute: false,
        blockedReason: 'execution_limit_exceeded',
      })
    );
  });

  it('allows an exact source-message fallback preview but not an empty preview', () => {
    expect(
      getMessageCleanupExecutionEligibility({
        mode: 'delete_only',
        status: 'ready',
        coverage: 'partial',
        scope: 'source_message',
        candidateCount: 1,
        banStatus: 'not_requested',
        caseFinalizationStatus: 'not_applicable',
      }).canExecute
    ).toBe(true);

    expect(
      getMessageCleanupExecutionEligibility({
        mode: 'delete_only',
        status: 'ready',
        coverage: 'ready',
        scope: 'source_message',
        candidateCount: 0,
        banStatus: 'not_requested',
        caseFinalizationStatus: 'not_applicable',
      }).blockedReason
    ).toBe('no_candidates');
  });

  it('allows only a completed combined job with failed finalization to retry', () => {
    const retry = getMessageCleanupExecutionEligibility({
      mode: 'ban_with_cleanup',
      status: 'completed',
      coverage: 'ready',
      scope: 'last_day',
      candidateCount: 4,
      banStatus: 'succeeded',
      caseFinalizationStatus: 'failed',
    });
    const completed = getMessageCleanupExecutionEligibility({
      mode: 'ban_with_cleanup',
      status: 'completed',
      coverage: 'ready',
      scope: 'last_day',
      candidateCount: 4,
      banStatus: 'succeeded',
      caseFinalizationStatus: 'succeeded',
    });

    expect(retry.canExecute).toBe(true);
    expect(completed).toEqual(
      expect.objectContaining({ canExecute: false, blockedReason: 'job_not_ready' })
    );
  });
});
