import { reportHandoffReasonSchema, type ReportAnalysisOutcome } from '@drasil/application';
import {
  Client,
  Collection,
  EmbedBuilder,
  type Message,
  type MessageCreateOptions,
} from 'discord.js';
import {
  InMemoryReportIntakeRepository,
  InMemoryServerRepository,
} from '../fakes/inMemoryRepositories';
import { ReportIntakeStatus } from '../../repositories/types';
import { processingMetadata } from '../../repositories/reportIntakeProcessing';
import {
  ReportIntakeHandoffService,
  REPORT_HANDOFF_RECEIPT,
} from '../../services/ReportIntakeHandoffService';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import type { IReportIntakeService } from '../../services/ReportIntakeService';
import type { IThreadManager } from '../../services/ThreadManager';

async function fixture(
  reason: 'no_match' | (typeof reportHandoffReasonSchema.options)[number] = 'no_match'
) {
  const servers = new InMemoryServerRepository();
  await servers.getOrCreateServer('guild');
  await servers.updateSettings('guild', { report_intake_staged_enabled: true });
  const repository = new InMemoryReportIntakeRepository(servers);
  const outcome: ReportAnalysisOutcome = {
    kind: 'admin_review',
    reason,
    candidates: [],
    coverage: { kind: 'unavailable', reason: 'transport' },
    includedEvidenceIds: [],
    excludedEvidenceIds: [],
  };
  const intake = await repository.create({
    serverId: 'guild',
    reporterId: 'reporter',
    threadId: 'thread',
    status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
    metadata: {
      analysis: {
        schemaVersion: 1,
        sources: {},
        requestReservations: [],
        outcome,
        coverage: outcome.coverage,
        handoff: {
          state: 'pending',
          reason,
          attempts: 0,
          nextDueAt: new Date().toISOString(),
          receipt: 'pending',
        },
      },
    },
  });
  const sent: Message[] = [];
  const channel = {
    id: 'thread',
    guildId: 'guild',
    messages: {
      fetch: jest.fn(async () => new Collection(sent.map((message) => [message.id, message]))),
    },
    send: jest.fn(async (payload: MessageCreateOptions) => {
      const message = {
        id: `receipt-${sent.length}`,
        channelId: 'thread',
        author: { id: 'bot' },
        createdTimestamp: Date.now(),
        embeds: (payload.embeds as EmbedBuilder[]).map((embed) => embed.toJSON()),
      } as Message;
      sent.push(message);
      return message;
    }),
  };
  const queue = {
    upsertReportIdentityReview: jest.fn(async () => {
      expect((await repository.findById(intake.id))?.status).toBe(
        ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION
      );
      return { delivered: true, created: true, channelId: 'queue', messageId: 'review' };
    }),
  };
  const intakeService = { publishSavedConfirmation: jest.fn().mockResolvedValue(true) };
  const threads = { retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined) };
  const client = { user: { id: 'bot' }, channels: { fetch: jest.fn().mockResolvedValue(channel) } };
  const service = new ReportIntakeHandoffService(
    repository,
    queue as unknown as IModerationQueueService,
    client as unknown as Client,
    intakeService as unknown as IReportIntakeService,
    threads as unknown as IThreadManager
  );
  return { repository, intake, outcome, service, channel, queue, intakeService, threads, client };
}

describe('saved report handoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  it.each(reportHandoffReasonSchema.options)(
    'persists %s before I/O and sends the exact receipt once',
    async (reason) => {
      const { service, repository, intake, channel } = await fixture(reason);
      expect(await service.deliverPending()).toBe(1);
      expect(channel.send).toHaveBeenCalledWith(
        expect.objectContaining({ content: REPORT_HANDOFF_RECEIPT, allowedMentions: { parse: [] } })
      );
      expect(
        processingMetadata((await repository.findById(intake.id))!).analysis.handoff
      ).toMatchObject({
        state: 'delivered',
        reason,
        receipt: 'sent',
        channelId: 'queue',
        messageId: 'review',
      });
      await service.deliverPending();
      expect(channel.send).toHaveBeenCalledTimes(1);
    }
  );
  it('applies 30 second, 2 minute, 10 minute, then daily retries without losing saved review', async () => {
    const { service, repository, intake, queue } = await fixture();
    queue.upsertReportIdentityReview.mockRejectedValue(new Error('unavailable'));
    const dues = [
      '2026-11-03T00:00:30.000Z',
      '2026-11-03T00:02:30.000Z',
      '2026-11-03T00:12:30.000Z',
      '2026-11-04T00:12:30.000Z',
    ];
    for (const due of dues) {
      await service.publishOutcome(intake.id);
      const saved = (await repository.findById(intake.id))!;
      expect(saved.status).toBe(ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION);
      expect(processingMetadata(saved).analysis.presentation).toMatchObject({
        nextDueAt: due,
        lastFailure: 'delivery_unavailable',
      });
      jest.setSystemTime(new Date(due));
    }
  });
  it('publishes only the requested saved result', async () => {
    const { service, repository, intake, queue } = await fixture();
    await repository.create({
      serverId: 'guild',
      reporterId: 'other',
      status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
      metadata: intake.metadata as Record<string, unknown>,
    });
    await service.publishOutcome(intake.id);
    expect(queue.upsertReportIdentityReview).toHaveBeenCalledTimes(1);
    expect(queue.upsertReportIdentityReview).toHaveBeenCalledWith(
      expect.objectContaining({ intake: expect.objectContaining({ id: intake.id }) })
    );
  });
  it('sends the saved receipt independently when the review destination is unavailable to staff', async () => {
    const { service, repository, intake, queue, channel } = await fixture();
    queue.upsertReportIdentityReview.mockResolvedValueOnce({
      delivered: false,
      created: false,
      channelId: '',
      messageId: '',
    });
    await service.publishOutcome(intake.id);
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: REPORT_HANDOFF_RECEIPT })
    );
    expect(
      processingMetadata((await repository.findById(intake.id))!).analysis.handoff
    ).toMatchObject({ state: 'pending', receipt: 'sent' });
    jest.advanceTimersByTime(30_000);
    queue.upsertReportIdentityReview.mockRejectedValueOnce(new Error('still unavailable'));
    await service.publishOutcome(intake.id);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(
      processingMetadata((await repository.findById(intake.id))!).analysis.handoff
    ).toMatchObject({ state: 'pending', receipt: 'sent' });
  });
  it('keeps a delivered review when receipt delivery fails and retries without extraction', async () => {
    const { service, repository, intake, channel, intakeService } = await fixture();
    channel.send.mockRejectedValueOnce(new Error('thread unavailable'));
    await service.deliverPending();
    expect(
      processingMetadata((await repository.findById(intake.id))!).analysis.handoff
    ).toMatchObject({
      state: 'delivered',
      receipt: 'pending',
      attempts: 1,
      nextDueAt: '2026-11-03T00:00:30.000Z',
    });
    jest.advanceTimersByTime(30_000);
    await service.deliverPending();
    expect(
      processingMetadata((await repository.findById(intake.id))!).analysis.handoff.receipt
    ).toBe('sent');
    expect(intakeService.publishSavedConfirmation).not.toHaveBeenCalled();
  });
  it('reconciles the receipt after accepted send and failed intake persistence', async () => {
    const { service, repository, channel } = await fixture();
    jest
      .spyOn(repository, 'completePresentation')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await service.deliverPending();
    jest.advanceTimersByTime(30_000);
    await service.deliverPending();
    expect(channel.send).toHaveBeenCalledTimes(1);
  });
  it('retains acknowledgement and original reason on a new evidence result', async () => {
    const { service, repository, intake, outcome, channel } = await fixture();
    const { metadata, analysis } = processingMetadata(intake);
    analysis.handoff = {
      state: 'acknowledged',
      reason: 'ambiguous',
      attempts: 1,
      receipt: 'sent',
      nextDueAt: null,
      acknowledgedBy: 'staff',
      acknowledgedAt: new Date().toISOString(),
    };
    analysis.outcome = { ...outcome, reason: 'no_match' };
    await repository.update(intake.id, { metadata: { ...metadata, analysis } });
    await service.deliverPending();
    expect(
      processingMetadata((await repository.findById(intake.id))!).analysis.handoff
    ).toMatchObject({
      state: 'acknowledged',
      reason: 'ambiguous',
      acknowledgedBy: 'staff',
      receipt: 'sent',
      messageId: 'review',
    });
    expect(channel.send).not.toHaveBeenCalled();
  });
  it('does not mark an unavailable confirmation source as published', async () => {
    const { service, repository, intake, client } = await fixture();
    const { metadata, analysis } = processingMetadata(intake);
    analysis.handoff = { state: 'none' };
    analysis.outcome = {
      kind: 'confirm',
      candidate: {
        candidateId: 'candidate',
        discordUserId: 'target',
        serverId: 'guild',
        username: 'target',
        globalName: null,
        nickname: null,
        displayName: null,
        avatarUrl: null,
        matchedFields: ['username'],
        sourceRefs: [],
        subjectMatches: [{ subjectId: 'target', sourceRefs: [], matchedFields: ['username'] }],
      },
      coverage: { kind: 'not_required', reason: 'validated_anchor' },
      includedEvidenceIds: [],
      excludedEvidenceIds: [],
    };
    await repository.update(intake.id, {
      status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
      metadata: { ...metadata, analysis },
    });
    client.channels.fetch.mockResolvedValueOnce(null as never);
    await service.deliverPending();
    expect(
      processingMetadata((await repository.findById(intake.id))!).analysis.presentation?.nextDueAt
    ).toBe('2026-11-03T00:00:30.000Z');
  });
});
