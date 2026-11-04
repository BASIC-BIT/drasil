import type { ReportAnalysisOutcome } from '@drasil/application';
import type { IConfigService } from '../../config/ConfigService';
import {
  InMemoryReportIntakeRepository,
  InMemoryServerRepository,
} from '../fakes/inMemoryRepositories';
import { ReportIntakeEvidenceKind } from '../../repositories/types';
import { processingMetadata } from '../../repositories/reportIntakeProcessing';
import type { IReportIntakeAgentService } from '../../services/ReportIntakeAgentService';
import { ReportIntakeAnalysisWorker } from '../../services/ReportIntakeAnalysisWorker';

const outcome: ReportAnalysisOutcome = {
  kind: 'admin_review',
  reason: 'no_match',
  candidates: [],
  coverage: { kind: 'unavailable', reason: 'transport' },
  includedEvidenceIds: ['evidence-1'],
  excludedEvidenceIds: [],
};

describe('ReportIntakeAnalysisWorker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  async function fixture() {
    const servers = new InMemoryServerRepository();
    await servers.getOrCreateServer('guild');
    await servers.updateSettings('guild', { report_intake_staged_enabled: true });
    const repository = new InMemoryReportIntakeRepository(servers);
    const intake = await repository.create({ serverId: 'guild', reporterId: 'reporter' });
    const batch = {
      intakeId: intake.id,
      sourceMessageId: 'message',
      sourceChannelId: 'thread',
      sourceAuthorId: 'reporter',
      sourceVersion: 1,
      sourceFingerprint: 'v1',
      observedAt: new Date(),
      editedAt: null,
      operation: 'upsert' as const,
      evidence: [{ kind: ReportIntakeEvidenceKind.REPORTER_TEXT, content: 'evidence' }],
    };
    await repository.recordEvidenceBatch(batch);
    jest.advanceTimersByTime(15_000);
    const config = {
      getServerConfig: jest
        .fn()
        .mockResolvedValue({ settings: { report_intake_staged_enabled: true } }),
    };
    const agent = {
      analyze: jest.fn().mockResolvedValue(outcome),
      scheduleAnalysisForThreadMessage: jest.fn(),
      runAnalysisForThreadMessage: jest.fn(),
    } satisfies jest.Mocked<IReportIntakeAgentService>;
    const worker = new ReportIntakeAnalysisWorker(
      repository,
      config as unknown as IConfigService,
      agent
    );
    return { repository, intake, batch, config, agent, worker, servers };
  }
  it('reserves before dispatch and commits the result once', async () => {
    const { repository, intake, agent, worker } = await fixture();
    agent.analyze.mockImplementation(async ({ reserveModelAttempt }) => {
      expect(await reserveModelAttempt()).toBe(true);
      expect((await repository.findById(intake.id))?.analysis_attempts).toBe(1);
      return outcome;
    });
    expect(await worker.processPending()).toBe(1);
    const saved = (await repository.findById(intake.id))!;
    expect(processingMetadata(saved).analysis.outcome).toEqual(outcome);
    expect(await worker.processPending()).toBe(0);
  });
  it('retains request budget after an unknown provider outcome', async () => {
    const { repository, intake, agent, worker } = await fixture();
    const first = (await repository.claimAnalysis(new Date(), 1_000))!;
    expect(await repository.reserveModelAttempt(first, new Date())).toBe(true);
    jest.advanceTimersByTime(1_001);
    let thirdReservation: boolean | undefined;
    agent.analyze.mockImplementation(async ({ claim, reserveModelAttempt }) => {
      expect(claim.deadline).toEqual(first.deadline);
      expect(claim.attempts).toBe(1);
      expect(await reserveModelAttempt()).toBe(true);
      thirdReservation = await reserveModelAttempt();
      return outcome;
    });
    await worker.processPending();
    const saved = (await repository.findById(intake.id))!;
    expect(saved.analysis_attempts).toBe(2);
    expect(thirdReservation).toBe(false);
    expect(saved.analysis_deadline_at).toEqual(first.deadline);
  });

  it.each(['stop', 'renewal_failure', 'disabled', 'superseded'] as const)(
    'aborts owned work and prevents publication after %s',
    async (interruption) => {
      const f = await fixture();
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let aborted = false;
      f.agent.analyze.mockImplementation(async ({ signal, reserveModelAttempt }) => {
        expect(await reserveModelAttempt()).toBe(true);
        entered();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('aborted'));
            },
            { once: true }
          )
        );
        return outcome;
      });
      const complete = jest.spyOn(f.repository, 'completeAnalysis');
      const pending = f.worker.processPending();
      await started;
      if (interruption === 'stop') f.worker.stop();
      if (interruption === 'renewal_failure')
        jest.spyOn(f.repository, 'renewAnalysisLease').mockResolvedValue(false);
      if (interruption === 'disabled') {
        await f.servers.updateSettings('guild', { report_intake_staged_enabled: false });
        f.config.getServerConfig.mockResolvedValue({
          settings: { report_intake_staged_enabled: false },
        });
      }
      if (interruption === 'superseded')
        await f.repository.recordEvidenceBatch({
          ...f.batch,
          sourceVersion: 2,
          sourceFingerprint: 'v2',
          observedAt: new Date(),
        });
      await jest.advanceTimersByTimeAsync(10_000);
      await pending;
      expect(aborted).toBe(true);
      expect(complete).not.toHaveBeenCalled();
      expect((await f.repository.findById(f.intake.id))?.analysis_revision).toBe(0);
      expect(await f.repository.listEvidence(f.intake.id)).not.toHaveLength(0);
    }
  );

  it('keeps one drain and aborts on the persisted deadline without another request', async () => {
    const f = await fixture();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.agent.analyze.mockImplementation(async ({ signal, reserveModelAttempt }) => {
      expect(await reserveModelAttempt()).toBe(true);
      entered();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      );
      return outcome;
    });
    const first = f.worker.processPending();
    const second = f.worker.processPending();
    await started;
    await jest.advanceTimersByTimeAsync(45_000);
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(f.agent.analyze).toHaveBeenCalledTimes(1);
    const saved = (await f.repository.findById(f.intake.id))!;
    expect(saved.analysis_attempts).toBe(1);
    expect(processingMetadata(saved).analysis.outcome).toMatchObject({
      kind: 'admin_review',
      reason: 'provider_failure',
    });
  });

  it('does not call the agent when a recovered investigation has already expired', async () => {
    const f = await fixture();
    const first = (await f.repository.claimAnalysis(new Date(), 1_000))!;
    await f.repository.reserveModelAttempt(first, new Date());
    jest.advanceTimersByTime(45_001);
    await f.worker.processPending();
    expect(f.agent.analyze).not.toHaveBeenCalled();
    expect((await f.repository.findById(f.intake.id))?.analysis_deadline_at).toEqual(
      first.deadline
    );
  });

  it('rechecks a disabled rollout before completing a successful analysis', async () => {
    const f = await fixture();
    f.agent.analyze.mockImplementation(async () => {
      f.config.getServerConfig.mockResolvedValue({
        settings: { report_intake_staged_enabled: false },
      });
      return outcome;
    });
    await f.worker.processPending();
    const saved = (await f.repository.findById(f.intake.id))!;
    expect(saved.analysis_revision).toBe(0);
    expect(saved.analysis_due_at).not.toBeNull();
  });

  it('routes an unanswered confirmation after ten minutes without analyzing again', async () => {
    const f = await fixture();
    const candidate = {
      candidateId: 'target',
      discordUserId: 'target',
      serverId: 'guild',
      username: 'target',
      globalName: null,
      nickname: null,
      displayName: 'Target',
      avatarUrl: null,
      sourceRefs: [],
      matchedFields: ['userId' as const],
      subjectMatches: [{ subjectId: 'target', sourceRefs: [], matchedFields: ['userId' as const] }],
    };
    f.agent.analyze.mockResolvedValue({
      kind: 'confirm',
      candidate,
      coverage: outcome.coverage,
      includedEvidenceIds: ['evidence-1'],
      excludedEvidenceIds: [],
    });
    await f.worker.processPending();
    expect((await f.repository.findById(f.intake.id))?.analysis_due_at).toEqual(
      new Date('2026-11-03T00:10:15Z')
    );
    jest.advanceTimersByTime(600_000);
    await f.worker.processPending();
    expect(f.agent.analyze).toHaveBeenCalledTimes(1);
    const saved = (await f.repository.findById(f.intake.id))!;
    expect(saved.analysis_attempts).toBe(0);
    expect(processingMetadata(saved).analysis.outcome).toMatchObject({
      kind: 'admin_review',
      reason: 'confirmation_timeout',
      candidates: [candidate],
    });
  });

  it('keeps post-handoff evidence admin owned and preserves acknowledgement', async () => {
    const f = await fixture();
    await f.worker.processPending();
    const saved = (await f.repository.findById(f.intake.id))!;
    const { metadata, analysis } = processingMetadata(saved);
    analysis.handoff = {
      state: 'acknowledged',
      reason: 'rejected',
      messageId: 'handoff',
      channelId: 'staff',
      attempts: 1,
      nextDueAt: null,
      receipt: 'sent',
      acknowledgedBy: 'moderator',
      acknowledgedAt: new Date().toISOString(),
    };
    await f.repository.update(saved.id, { metadata: { ...metadata, analysis } });
    await f.repository.recordEvidenceBatch({
      ...f.batch,
      sourceVersion: 2,
      sourceFingerprint: 'v2',
      observedAt: new Date(),
    });
    jest.advanceTimersByTime(60_000);
    const candidate = {
      candidateId: 'target',
      discordUserId: 'target',
      serverId: 'guild',
      username: 'target',
      globalName: null,
      nickname: null,
      displayName: 'Target',
      avatarUrl: null,
      sourceRefs: [],
      matchedFields: ['userId' as const],
      subjectMatches: [{ subjectId: 'target', sourceRefs: [], matchedFields: ['userId' as const] }],
    };
    f.agent.analyze.mockResolvedValue({
      kind: 'confirm',
      candidate,
      coverage: outcome.coverage,
      includedEvidenceIds: ['evidence-2'],
      excludedEvidenceIds: [],
    });
    await f.worker.processPending();
    const updated = (await f.repository.findById(f.intake.id))!;
    expect(updated.status).toBe('needs_admin_confirmation');
    expect(processingMetadata(updated).analysis.handoff).toEqual(analysis.handoff);
    expect(processingMetadata(updated).analysis.outcome).toMatchObject({
      kind: 'admin_review',
      reason: 'rejected',
      candidates: [candidate],
    });
  });

  it('bounds a tick to five claims and does not start another drain while one runs', async () => {
    const f = await fixture();
    for (let i = 0; i < 6; i++) {
      const intake = await f.repository.create({ serverId: 'guild', reporterId: 'reporter' });
      await f.repository.recordEvidenceBatch({ ...f.batch, intakeId: intake.id });
    }
    expect(await f.worker.processPending(99)).toBe(5);
    expect(await f.worker.processPending(99)).toBe(2);
  });
});
