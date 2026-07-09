import {
  ReportReviewService,
  type ReportCaseOpener,
  type ReportOpenCaseCandidate,
  type ReportOpenCaseRepository,
  type ReportReviewClosureStatus,
  type ReportReviewQueueRepository,
  type ReportReviewRecord,
  type ReportReviewRepository,
} from '../../services/ReportReviewService';
import type {
  QueueAttentionItemRecord,
  QueueMessageDeleter,
} from '../../services/QueueAttentionService';

class FakeReportReviewRepository implements ReportReviewRepository {
  public closedInput: {
    reportId: string;
    serverId: string;
    status: ReportReviewClosureStatus;
    closedAt: Date;
    metadata: Record<string, unknown>;
  } | null = null;

  public closeResult: ReportReviewRecord | null = {
    id: 'report-1',
    server_id: 'guild-1',
    thread_id: 'thread-1',
    status: 'actioned',
  };

  public async closeSubmittedReport(input: {
    reportId: string;
    serverId: string;
    status: ReportReviewClosureStatus;
    closedAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<ReportReviewRecord | null> {
    this.closedInput = input;
    return this.closeResult;
  }
}

class FakeReportReviewQueueRepository implements ReportReviewQueueRepository {
  public items: QueueAttentionItemRecord[] = [
    {
      id: 'queue-1',
      server_id: 'guild-1',
      item_type: 'report_thread_attention',
      queue_channel_id: 'queue-channel',
      queue_message_id: 'queue-message',
    },
  ];

  public async deleteReportThreadAttention(): Promise<QueueAttentionItemRecord[]> {
    const deleted = this.items;
    this.items = [];
    return deleted;
  }
}

const baseOpenCaseCandidate: ReportOpenCaseCandidate = {
  id: 'report-1',
  server_id: 'guild-1',
  status: 'submitted',
  confirmed_target_user_id: 'user-1',
  latest_detection_id: 'det-1',
  latest_case_id: null,
};

class FakeReportOpenCaseRepository implements ReportOpenCaseRepository {
  public candidate: ReportOpenCaseCandidate | null = { ...baseOpenCaseCandidate };

  public async findSubmittedReportCaseCandidate(): Promise<ReportOpenCaseCandidate | null> {
    return this.candidate;
  }
}

describe('ReportReviewService', () => {
  const actor = { id: 'moderator-1', surface: 'web' as const };
  const now = new Date('2026-07-08T13:00:00.000Z');

  it('closes submitted reports with actor metadata and clears report attention', async () => {
    const repository = new FakeReportReviewRepository();
    const queueRepository = new FakeReportReviewQueueRepository();
    const queueMessageDeleter: QueueMessageDeleter = {
      deleteQueueMessage: jest.fn(async () => undefined),
    };
    const service = new ReportReviewService(repository, queueRepository, queueMessageDeleter);

    const result = await service.closeSubmittedReport({
      actor,
      action: 'mark_actioned',
      reportId: 'report-1',
      serverId: 'guild-1',
      now,
    });

    expect(result).toEqual({
      actor,
      action: 'mark_actioned',
      reportId: 'report-1',
      reportStatus: 'actioned',
      status: 'closed',
      queueCleanupStatus: 'cleared',
    });
    expect(repository.closedInput).toEqual({
      reportId: 'report-1',
      serverId: 'guild-1',
      status: 'actioned',
      closedAt: now,
      metadata: {
        closed_by: actor.id,
        closed_action: 'mark_actioned',
        closed_at: now.toISOString(),
        closed_surface: 'web',
      },
    });
    expect(queueMessageDeleter.deleteQueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-1' })
    );
    expect(queueRepository.items).toEqual([]);
  });

  it('treats already closed or missing reports as already handled', async () => {
    const repository = new FakeReportReviewRepository();
    repository.closeResult = null;
    const queueRepository = new FakeReportReviewQueueRepository();
    const queueMessageDeleter: QueueMessageDeleter = {
      deleteQueueMessage: jest.fn(async () => undefined),
    };
    const service = new ReportReviewService(repository, queueRepository, queueMessageDeleter);

    const result = await service.closeSubmittedReport({
      actor,
      action: 'dismiss_no_action',
      reportId: 'report-1',
      serverId: 'guild-1',
      now,
    });

    expect(result).toMatchObject({
      reportStatus: 'dismissed',
      status: 'already_handled',
      queueCleanupStatus: 'skipped',
    });
    expect(queueMessageDeleter.deleteQueueMessage).not.toHaveBeenCalled();
  });

  it('does not fail report closure when queue cleanup fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repository = new FakeReportReviewRepository();
    const queueRepository: ReportReviewQueueRepository = {
      deleteReportThreadAttention: jest.fn(async () => {
        throw new Error('Discord queue unavailable');
      }),
    };
    const queueMessageDeleter: QueueMessageDeleter = {
      deleteQueueMessage: jest.fn(async () => undefined),
    };
    const service = new ReportReviewService(repository, queueRepository, queueMessageDeleter);

    const result = await service.closeSubmittedReport({
      actor,
      action: 'mark_false_positive',
      reportId: 'report-1',
      serverId: 'guild-1',
      now,
    });

    expect(result).toMatchObject({
      reportStatus: 'false_positive',
      status: 'closed',
      queueCleanupStatus: 'failed',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clear report-thread attention'),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('opens submitted report cases through the injected observed-case opener', async () => {
    const repository = new FakeReportReviewRepository();
    const queueRepository = new FakeReportReviewQueueRepository();
    const queueMessageDeleter: QueueMessageDeleter = {
      deleteQueueMessage: jest.fn(async () => undefined),
    };
    const openCaseRepository = new FakeReportOpenCaseRepository();
    const reportCaseOpener: ReportCaseOpener = {
      openObservedDetectionCase: jest.fn(async () => ({
        caseId: 'case-1',
        status: 'opened' as const,
      })),
    };
    const service = new ReportReviewService(
      repository,
      queueRepository,
      queueMessageDeleter,
      openCaseRepository,
      reportCaseOpener
    );

    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toEqual({
      actor,
      action: 'open_case',
      caseId: 'case-1',
      detectionEventId: 'det-1',
      reportId: 'report-1',
      status: 'opened',
      targetUserId: 'user-1',
      queueCleanupStatus: 'cleared',
    });
    expect(reportCaseOpener.openObservedDetectionCase).toHaveBeenCalledWith({
      actor,
      detectionEventId: 'det-1',
      reportId: 'report-1',
      serverId: 'guild-1',
      userId: 'user-1',
    });
    expect(queueMessageDeleter.deleteQueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-1' })
    );
  });

  it('does not offer submitted-report case open without an opener', async () => {
    const service = new ReportReviewService(
      new FakeReportReviewRepository(),
      undefined,
      undefined,
      new FakeReportOpenCaseRepository()
    );

    expect(service.canOpenSubmittedReportCase()).toBe(false);
    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toMatchObject({
      status: 'opener_unavailable',
      queueCleanupStatus: 'skipped',
    });
  });

  it('rejects submitted report case open when the report is stale or incomplete', async () => {
    const openCaseRepository = new FakeReportOpenCaseRepository();
    const reportCaseOpener: ReportCaseOpener = {
      openObservedDetectionCase: jest.fn(async () => ({ status: 'opened' as const })),
    };
    const service = new ReportReviewService(
      new FakeReportReviewRepository(),
      undefined,
      undefined,
      openCaseRepository,
      reportCaseOpener
    );

    openCaseRepository.candidate = null;
    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toMatchObject({ status: 'already_handled' });

    openCaseRepository.candidate = {
      id: 'report-1',
      server_id: 'guild-1',
      status: 'submitted',
      confirmed_target_user_id: null,
      latest_detection_id: 'det-1',
      latest_case_id: null,
    };
    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toMatchObject({ status: 'missing_target' });

    openCaseRepository.candidate = {
      ...baseOpenCaseCandidate,
      confirmed_target_user_id: 'user-1',
      latest_detection_id: null,
    };
    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toMatchObject({ status: 'missing_detection' });

    expect(reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
  });

  it('returns queued when submitted report case open is handed to a bot worker', async () => {
    const openCaseRepository = new FakeReportOpenCaseRepository();
    const reportCaseOpener: ReportCaseOpener = {
      openObservedDetectionCase: jest.fn(async () => ({ status: 'queued' as const })),
    };
    const service = new ReportReviewService(
      new FakeReportReviewRepository(),
      undefined,
      undefined,
      openCaseRepository,
      reportCaseOpener
    );

    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toMatchObject({
      detectionEventId: 'det-1',
      status: 'queued',
      targetUserId: 'user-1',
    });
  });

  it('returns an existing case instead of opening a duplicate', async () => {
    const openCaseRepository = new FakeReportOpenCaseRepository();
    openCaseRepository.candidate = {
      ...baseOpenCaseCandidate,
      latest_case_id: 'case-1',
    };
    const reportCaseOpener: ReportCaseOpener = {
      openObservedDetectionCase: jest.fn(async () => ({ status: 'opened' as const })),
    };
    const service = new ReportReviewService(
      new FakeReportReviewRepository(),
      undefined,
      undefined,
      openCaseRepository,
      reportCaseOpener
    );

    await expect(
      service.openCaseFromSubmittedReport({
        actor,
        reportId: 'report-1',
        serverId: 'guild-1',
      })
    ).resolves.toMatchObject({
      caseId: 'case-1',
      status: 'case_exists',
    });
    expect(reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
  });
});
