import {
  createAttentionActions,
  createReportActions,
  projectReportIntakeState,
} from '@drasil/application';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ModerationQueueRepository } from '../../repositories/ModerationQueueRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ReportIntakeService } from '../../services/ReportIntakeService';
import { processingMetadata } from '../../repositories/reportIntakeProcessing';
import {
  ModerationQueueItemType,
  ReportIntakeEvidenceKind,
  ReportIntakeStatus,
} from '../../repositories/types';
import type { IConfigService } from '../../config/ConfigService';
import type { IReportCandidateService } from '../../services/ReportCandidateService';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import type { IThreadManager } from '../../services/ThreadManager';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const context = {
  guildId: 'guild-resolution',
  requestId: 'resolve',
  source: 'discord_interaction',
  actor: { kind: 'user' as const, userId: 'staff' },
};
const authority = {
  loadFresh: async (guildId: string, userId: string) => ({
    guildId,
    userId,
    present: true,
    owner: false,
    permissions: userId === 'staff' ? '32' : '0',
    roleIds: [],
  }),
};

describeIntegration('staged report staff resolution', () => {
  async function fixture() {
    const prisma = getPrismaClient();
    const server = new ServerRepository(prisma);
    await server.getOrCreateServer(context.guildId);
    await server.updateSettings(context.guildId, { report_intake_staged_enabled: true });
    const users = new UserRepository(prisma);
    await users.getOrCreateUser('reporter-resolution', 'reporter', new Date('2020-01-01'));
    const repository = new ReportIntakeRepository(prisma);
    const queue = new ModerationQueueRepository(prisma);
    const at = new Date();
    const intake = await repository.create({
      serverId: context.guildId,
      reporterId: 'reporter-resolution',
      threadId: 'thread-resolution',
      status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
      metadata: {
        retained: 'evidence context',
        admin_review_prompt_revision: 1,
        admin_review_prompt_message_id: 'review-message',
        analysis: {
          schemaVersion: 1,
          sources: {},
          requestReservations: [],
          coverage: null,
          outcome: {
            kind: 'admin_review',
            reason: 'no_match',
            candidates: [],
            coverage: { kind: 'unavailable', reason: 'transport' },
            includedEvidenceIds: [],
            excludedEvidenceIds: [],
          },
          handoff: {
            state: 'delivered',
            reason: 'no_match',
            attempts: 1,
            nextDueAt: null,
            receipt: 'sent',
            messageId: 'review-message',
            channelId: 'review-channel',
          },
          presentation: { revision: 1, attempts: 1, nextDueAt: null, lease: null },
        },
      },
    });
    await prisma.report_intakes.update({
      where: { id: intake.id },
      data: { evidence_revision: 1, analysis_revision: 1 },
    });
    await repository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
      content: 'Synthetic report evidence',
    });
    const item = await queue.upsert({
      serverId: context.guildId,
      userId: intake.reporter_id,
      reportIntakeId: intake.id,
      itemType: ModerationQueueItemType.REPORT_THREAD_ATTENTION,
      sourceThreadId: intake.thread_id,
      queueChannelId: 'review-channel',
      queueMessageId: 'review-message',
      metadata: { identity_review: { revision: 1 } },
    });
    const service = new ReportIntakeService(
      repository,
      server,
      users,
      new ServerMemberRepository(prisma),
      {} as IConfigService,
      {} as IReportCandidateService,
      {
        retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined),
      } as unknown as IThreadManager,
      {
        deleteReportThreadAttention: async (id: string) => {
          for (const row of await queue.listByReportIntake(id)) await queue.deleteById(row.id);
        },
      } as IModerationQueueService
    );
    const confirmed = jest.fn(async () => ({
      status: 'submitted' as const,
      targetUserId: 'target-resolution',
    }));
    const actions = createReportActions({
      authority,
      settings: { loadFresh: async () => ({ reasonRequired: false, staffRoleIds: [] }) },
      intakes: {
        load: async (id) => {
          const current = await repository.findById(id);
          return current ? projectReportIntakeState(current) : null;
        },
        findOpen: async () => null,
        open: async () => {
          throw new Error('not used');
        },
        markOpenFailed: async () => {},
        confirm: async (ctx, command, staff) =>
          service.confirmCandidate({
            intakeId: command.intakeId,
            targetUserId: command.targetUserId,
            confirmedById: ctx.actor.kind === 'user' ? ctx.actor.userId : '',
            confirmedByStaff: staff,
            expectedEvidenceRevision: command.expectedEvidenceRevision,
            promptMessageId: command.promptMessageId,
          }),
        reject: async () => {
          throw new Error('not used');
        },
        close: async (ctx, state, staff, command) =>
          service.closeIntakeForThread({
            threadId: state.threadId!,
            closedById: ctx.actor.kind === 'user' ? ctx.actor.userId : '',
            closedByStaff: staff,
            closeMode: command.closeMode,
            expectedEvidenceRevision: command.expectedEvidenceRevision,
            promptMessageId: command.promptMessageId,
          }),
        markSubmitted: async (_ctx, state) =>
          service.markSubmitted({
            intakeId: state.id,
            targetUserId: state.confirmedTargetUserId!,
            submittedById: 'staff',
          }),
      },
      threads: {
        prepareClose: async () => ({
          finish: async (result) => ({ archived: true, message: result.message }),
        }),
        notifySubmitted: async () => {},
        create: async () => null,
        activate: async () => false,
        deleteFailed: async () => {},
        notifyOpened: async () => {},
      },
      submissions: {
        confirmed,
        user: async () => {
          throw new Error('not used');
        },
        message: async () => {
          throw new Error('not used');
        },
      },
    });
    const selection = {
      kind: 'confirm_intake_candidate' as const,
      intakeId: intake.id,
      threadId: 'thread-resolution',
      targetUserId: 'target-resolution',
      expectedEvidenceRevision: 1,
      promptMessageId: 'review-message',
    };
    const resolution = {
      kind: 'close_report_intake' as const,
      intakeId: intake.id,
      expectedEvidenceRevision: 1,
      promptMessageId: 'review-message',
      closeMode: { kind: 'resolve_review' as const, reason: 'Identity cannot be established' },
    };
    return {
      prisma,
      repository,
      queue,
      service,
      intake,
      item,
      at,
      actions,
      confirmed,
      selection,
      resolution,
    };
  }

  it('acknowledges identity review without resolving it', async () => {
    const f = await fixture();
    const deleteQueueMessage = jest.fn();
    const actions = createAttentionActions({
      authority,
      repository: f.queue,
      messageDeleter: { deleteQueueMessage },
    });
    const first = await actions.acknowledge(context, { itemId: f.item.id });
    expect(first).toMatchObject({ outcome: { status: 'acknowledged' } });
    const savedIntake = (await f.repository.findById(f.intake.id))!;
    const savedHandoff = processingMetadata(savedIntake).analysis.handoff;
    expect(savedIntake.status).toBe('needs_admin_confirmation');
    expect(savedHandoff.state).toBe('acknowledged');
    expect(savedHandoff).toMatchObject({
      acknowledgedBy: 'staff',
      acknowledgedAt: expect.any(String),
      reason: 'no_match',
      receipt: 'sent',
      messageId: 'review-message',
    });
    expect(savedIntake.closed_at).toBeNull();
    expect(await f.queue.findById(f.item.id)).not.toBeNull();
    expect(deleteQueueMessage).not.toHaveBeenCalled();
    expect(await actions.acknowledge(context, { itemId: f.item.id })).toMatchObject({
      outcome: { status: 'already_handled' },
    });
  });

  it('preserves acknowledged review when the reporter closes the thread, then resolves it with staff reason', async () => {
    const f = await fixture();
    await f.queue.acknowledgeIdentityReview({
      itemId: f.item.id,
      guildId: context.guildId,
      actorId: 'staff',
      acknowledgedAt: f.at,
    });
    const close = await f.actions.execute(
      { ...context, actor: { kind: 'user', userId: 'reporter-resolution' } },
      { kind: 'close_report_intake', intakeId: f.intake.id }
    );
    expect(close).toMatchObject({ outcome: { status: 'closed' } });
    expect(await f.repository.findById(f.intake.id)).toMatchObject({
      status: 'needs_admin_confirmation',
      closed_at: null,
    });
    expect(await f.queue.findById(f.item.id)).not.toBeNull();
    expect(await f.actions.execute(context, f.resolution)).toMatchObject({
      outcome: { status: 'closed' },
    });
    const saved = (await f.repository.findById(f.intake.id))!;
    expect(saved.metadata).toMatchObject({
      retained: 'evidence context',
      closed_reason: 'Identity cannot be established',
      analysis: {
        handoff: {
          state: 'resolved',
          acknowledgedBy: 'staff',
          resolvedBy: 'staff',
          reason: 'no_match',
        },
      },
    });
    expect(await f.repository.listEvidence(f.intake.id)).toHaveLength(1);
  });

  it('keeps selected admin review open when submission fails and the reporter closes the thread', async () => {
    const f = await fixture();
    f.confirmed.mockRejectedValueOnce(new Error('submission unavailable'));
    await expect(f.actions.execute(context, f.selection)).rejects.toThrow('submission unavailable');
    expect(await f.repository.findById(f.intake.id)).toMatchObject({
      confirmed_target_user_id: 'target-resolution',
      status: 'needs_admin_confirmation',
    });
    expect(
      await f.actions.execute(
        { ...context, actor: { kind: 'user', userId: f.intake.reporter_id } },
        { kind: 'close_report_intake', intakeId: f.intake.id }
      )
    ).toMatchObject({ outcome: { status: 'closed' } });
    const saved = (await f.repository.findById(f.intake.id))!;
    expect(saved.status).toBe('needs_admin_confirmation');
    expect(saved.closed_at).toBeNull();
    expect(saved.confirmed_target_user_id).toBe('target-resolution');
    expect(processingMetadata(saved).analysis.handoff.state).toBe('delivered');
    expect(await f.queue.findById(f.item.id)).not.toBeNull();
    expect(await f.repository.listEvidence(f.intake.id)).toHaveLength(2);
  });

  it('lets the reporter start another report after closing only the handed-off thread', async () => {
    const f = await fixture();
    expect(
      await f.service.findOpenIntakeForReporter({
        serverId: context.guildId,
        reporterId: f.intake.reporter_id,
      })
    ).toMatchObject({ id: f.intake.id });
    await f.service.closeIntakeForThread({
      threadId: 'thread-resolution',
      closedById: f.intake.reporter_id,
    });
    expect(
      await f.service.findOpenIntakeForReporter({
        serverId: context.guildId,
        reporterId: f.intake.reporter_id,
      })
    ).toBeNull();
    const next = await f.repository.create({
      serverId: context.guildId,
      reporterId: f.intake.reporter_id,
      threadId: 'next-report-thread',
    });
    expect(
      await f.service.findOpenIntakeForReporter({
        serverId: context.guildId,
        reporterId: f.intake.reporter_id,
      })
    ).toMatchObject({ id: next.id });
    expect(await f.repository.findById(f.intake.id)).toMatchObject({
      status: 'needs_admin_confirmation',
      closed_at: null,
    });
    expect(await f.queue.findById(f.item.id)).not.toBeNull();
  });

  it('submits exactly once when two current staff confirmations race', async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.actions.execute(context, f.selection),
      f.actions.execute(context, f.selection),
    ]);
    expect(
      results.filter((result) => result.kind === 'outcome' && result.outcome.status === 'submitted')
    ).toHaveLength(1);
    expect(f.confirmed).toHaveBeenCalledTimes(1);
    expect(await f.repository.findById(f.intake.id)).toMatchObject({
      status: 'submitted',
      metadata: { analysis: { handoff: { state: 'resolved', resolvedBy: 'staff' } } },
    });
  });

  it.each([true, false])(
    'serializes review resolution and target claim, selection first: %s',
    async (selectionFirst) => {
      const f = await fixture();
      const confirm = () => f.actions.execute(context, f.selection);
      const close = () => f.actions.execute(context, f.resolution);
      await Promise.all(selectionFirst ? [confirm(), close()] : [close(), confirm()]);
      const saved = (await f.repository.findById(f.intake.id))!;
      expect(['submitted', 'closed_by_reporter']).toContain(saved.status);
      expect(f.confirmed).toHaveBeenCalledTimes(saved.status === 'submitted' ? 1 : 0);
      expect(saved.metadata).toMatchObject({ analysis: { handoff: { state: 'resolved' } } });
      expect(await f.repository.listEvidence(f.intake.id)).toHaveLength(
        saved.status === 'submitted' ? 2 : 1
      );
    }
  );

  it('reclassifies a report attention row promoted between read and reservation', async () => {
    const f = await fixture();
    await f.prisma.moderation_queue_items.update({
      where: { id: f.item.id },
      data: { metadata: {} },
    });
    const read = f.queue.findById.bind(f.queue);
    jest.spyOn(f.queue, 'findById').mockImplementationOnce(async (id) => {
      const snapshot = await read(id);
      await f.queue.upsert({
        serverId: context.guildId,
        userId: f.intake.reporter_id,
        itemType: ModerationQueueItemType.REPORT_THREAD_ATTENTION,
        reportIntakeId: f.intake.id,
        sourceThreadId: f.intake.thread_id,
        metadata: { identity_review: { revision: 1 } },
      });
      return snapshot;
    });
    const deleteQueueMessage = jest.fn();
    const actions = createAttentionActions({
      repository: f.queue,
      authority,
      messageDeleter: { deleteQueueMessage },
    });
    expect(await actions.acknowledge(context, { itemId: f.item.id })).toMatchObject({
      outcome: { status: 'acknowledged' },
    });
    expect(await f.queue.findById(f.item.id)).toMatchObject({ attention_cleanup_pending: false });
    expect(
      processingMetadata((await f.repository.findById(f.intake.id))!).analysis.handoff.state
    ).toBe('acknowledged');
    expect(deleteQueueMessage).not.toHaveBeenCalled();
  });

  it('retains failed cleanup and publishes a separate live review without changing reserved message IDs', async () => {
    const f = await fixture();
    await f.prisma.moderation_queue_items.update({
      where: { id: f.item.id },
      data: { metadata: {} },
    });
    const deleteQueueMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('old channel unavailable'))
      .mockResolvedValue(undefined);
    const actions = createAttentionActions({
      repository: f.queue,
      authority,
      messageDeleter: { deleteQueueMessage },
    });
    await expect(actions.acknowledge(context, { itemId: f.item.id })).rejects.toThrow(
      'old channel unavailable'
    );
    const reserved = await f.queue.findById(f.item.id);
    expect(reserved).toMatchObject({
      attention_cleanup_pending: true,
      queue_message_id: 'review-message',
      queue_channel_id: 'review-channel',
    });
    expect(await f.queue.listByReportIntake(f.intake.id)).toHaveLength(0);
    expect(
      await f.queue.findAttentionByThread(
        ModerationQueueItemType.REPORT_THREAD_ATTENTION,
        f.intake.thread_id!
      )
    ).toBeNull();
    // A producer that read the old row before reservation must also create a new generation.
    jest.spyOn(f.queue, 'findAttentionByThread').mockResolvedValueOnce(f.item);
    const live = await f.queue.upsert({
      serverId: context.guildId,
      userId: f.intake.reporter_id,
      itemType: ModerationQueueItemType.REPORT_THREAD_ATTENTION,
      reportIntakeId: f.intake.id,
      sourceThreadId: f.intake.thread_id,
      metadata: { identity_review: { revision: 1 } },
    });
    expect(live.id).not.toBe(f.item.id);
    expect(live.queue_message_id).toBeNull();
    expect(await f.queue.updateDiscordMessage(f.item.id, 'new-channel', 'new-message')).toBeNull();
    await f.queue.updateDiscordMessage(live.id, 'fallback-channel', 'live-review-message');
    expect(await f.queue.findById(f.item.id)).toMatchObject({
      queue_message_id: 'review-message',
      queue_channel_id: 'review-channel',
    });
    expect(await actions.acknowledge(context, { itemId: f.item.id })).toMatchObject({
      outcome: { status: 'acknowledged' },
    });
    expect(await f.queue.findById(f.item.id)).toBeNull();
    expect(await f.queue.findById(live.id)).toMatchObject({
      attention_cleanup_pending: false,
      queue_message_id: 'live-review-message',
    });
    expect(deleteQueueMessage.mock.calls.map(([item]) => item.queue_message_id)).toEqual([
      'review-message',
      'review-message',
    ]);
  });

  it('keeps the deployed verification conflict target valid before and after ordinary reservation', async () => {
    const f = await fixture();
    const verification = await f.prisma.verification_events.create({
      data: { server_id: context.guildId, user_id: f.intake.reporter_id },
    });
    const oldCaseUpsert = () => f.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO moderation_queue_items(server_id,user_id,item_type,verification_event_id)
      VALUES (${context.guildId},${f.intake.reporter_id},'case_mirror',${verification.id}::uuid)
      ON CONFLICT (item_type,verification_event_id) WHERE verification_event_id IS NOT NULL
      DO UPDATE SET updated_at=now() RETURNING id`;
    const first = await oldCaseUpsert();
    expect(await oldCaseUpsert()).toEqual(first);
    const breach = await f.queue.upsert({
      serverId: context.guildId,
      userId: f.intake.reporter_id,
      itemType: ModerationQueueItemType.QUARANTINE_BREACH_ATTENTION,
      verificationEventId: verification.id,
      sourceThreadId: 'breach-thread',
      queueChannelId: 'old-channel',
      queueMessageId: 'old-message',
    });
    const reserved = await f.queue.reserveOrdinaryAcknowledgement(breach.id, context.guildId);
    expect(reserved).toMatchObject({
      attention_cleanup_pending: true,
      verification_event_id: null,
      source_thread_id: null,
      metadata: {
        attention_cleanup: {
          source_thread_id: 'breach-thread',
          verification_event_id: verification.id,
          detection_event_id: null,
        },
      },
    });
    const newBreach = await f.queue.upsert({
      serverId: context.guildId,
      userId: f.intake.reporter_id,
      itemType: ModerationQueueItemType.QUARANTINE_BREACH_ATTENTION,
      verificationEventId: verification.id,
      sourceThreadId: 'breach-thread',
    });
    expect(newBreach.id).not.toBe(breach.id);
    expect(newBreach.queue_message_id).toBeNull();
    expect(await oldCaseUpsert()).toEqual(first);
  });

  it('rejects target and close snapshots when only the evidence revision changed', async () => {
    const f = await fixture();
    const snapshot = (await f.repository.findById(f.intake.id))!;
    await f.prisma.report_intakes.update({
      where: { id: snapshot.id },
      data: { evidence_revision: 2 },
    });
    expect(
      await f.repository.confirmTargetIfUnset(snapshot.id, {
        targetUserId: 'target-resolution',
        expectedMetadata: snapshot.metadata,
        expectedEvidenceRevision: 1,
        expectedStatus: snapshot.status,
        metadata: { selected: true },
      })
    ).toBeNull();
    expect(
      await f.repository.updateIfCurrent(snapshot, {
        status: ReportIntakeStatus.CLOSED_BY_REPORTER,
      })
    ).toBeNull();
    expect(await f.actions.execute(context, f.selection)).toMatchObject({ kind: 'denied' });
    expect(await f.actions.execute(context, f.resolution)).toMatchObject({ kind: 'denied' });
    expect(f.confirmed).not.toHaveBeenCalled();
  });
});
