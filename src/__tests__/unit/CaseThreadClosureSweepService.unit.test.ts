import { CaseThreadClosureSweepService } from '../../services/CaseThreadClosureSweepService';
import { VerificationEvent, VerificationStatus } from '../../repositories/types';

const buildVerificationEvent = (overrides: Partial<VerificationEvent> = {}): VerificationEvent => ({
  id: overrides.id ?? 'case-1',
  server_id: overrides.server_id ?? 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  detection_event_id: overrides.detection_event_id ?? null,
  thread_id: overrides.thread_id ?? 'thread-1',
  private_evidence_thread_id: overrides.private_evidence_thread_id ?? 'evidence-thread-1',
  notification_channel_id: overrides.notification_channel_id ?? null,
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.CLOSED_NO_ACTION,
  created_at: overrides.created_at ?? new Date(),
  updated_at: overrides.updated_at ?? new Date(),
  resolved_at: overrides.resolved_at ?? new Date(),
  resolved_by: overrides.resolved_by ?? 'admin-1',
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

describe('CaseThreadClosureSweepService (unit)', () => {
  it('dry-runs resolved thread cleanup without executing closures', async () => {
    const verificationEvent = buildVerificationEvent();
    const verificationRepo = {
      findResolvedWithThreadsByServer: jest.fn().mockResolvedValue([verificationEvent]),
    } as any;
    const threadManager = {
      closeResolvedVerificationThreads: jest.fn().mockResolvedValue({
        closedAny: false,
        results: [
          {
            threadId: 'thread-1',
            threadKind: 'case',
            wouldClose: true,
            closed: false,
            alreadyClosed: false,
            missing: false,
            error: null,
          },
        ],
      }),
    } as any;
    const service = new CaseThreadClosureSweepService(verificationRepo, threadManager);

    const report = await service.sweepResolvedCaseThreads({ serverId: 'guild-1' });

    expect(threadManager.closeResolvedVerificationThreads).toHaveBeenCalledWith(verificationEvent, {
      execute: false,
    });
    expect(report.execute).toBe(false);
    expect(report.wouldCloseThreads).toBe(1);
    expect(report.closedThreads).toBe(0);
  });

  it('executes resolved thread cleanup when requested', async () => {
    const verificationEvent = buildVerificationEvent();
    const verificationRepo = {
      findResolvedWithThreadsByServer: jest.fn().mockResolvedValue([verificationEvent]),
    } as any;
    const threadManager = {
      closeResolvedVerificationThreads: jest.fn().mockResolvedValue({
        closedAny: true,
        results: [
          {
            threadId: 'thread-1',
            threadKind: 'case',
            wouldClose: true,
            closed: true,
            alreadyClosed: false,
            missing: false,
            error: null,
          },
        ],
      }),
    } as any;
    const service = new CaseThreadClosureSweepService(verificationRepo, threadManager);

    const report = await service.sweepResolvedCaseThreads({ serverId: 'guild-1', execute: true });

    expect(threadManager.closeResolvedVerificationThreads).toHaveBeenCalledWith(verificationEvent, {
      execute: true,
    });
    expect(report.execute).toBe(true);
    expect(report.closedThreads).toBe(1);
  });
});
