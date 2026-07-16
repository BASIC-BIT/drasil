import { PrismaClient } from '../../db/prisma';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { MessageDeletionJobRepository } from '../../repositories/MessageDeletionJobRepository';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import {
  DetectionType,
  MessageDeletionCoverage,
  MessageDeletionDiscoverySource,
  MessageDeletionEvidenceStatus,
  MessageDeletionItemStatus,
  MessageDeletionJobMode,
  MessageDeletionJobStatus,
  MessageDeletionScope,
  ModerationActionRequestStatus,
  ModerationActionRequestType,
  VerificationStatus,
} from '../../repositories/types';
import { UserRepository } from '../../repositories/UserRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('MessageDeletionJobRepository (integration)', () => {
  let prisma: PrismaClient;
  let jobs: MessageDeletionJobRepository;
  let requests: ModerationActionRequestRepository;

  beforeEach(() => {
    prisma = getPrismaClient();
    jobs = new MessageDeletionJobRepository(prisma);
    requests = new ModerationActionRequestRepository(prisma);
  });

  async function createPendingCase() {
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const detections = new DetectionEventsRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    await servers.getOrCreateServer('guild-1');
    await users.getOrCreateUser('user-1', 'target');
    const detection = await detections.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.PATTERN_MATCH,
      confidence: 1,
      reasons: ['Matched configured indicator'],
      message_id: 'message-1',
      channel_id: 'channel-1',
    });
    const verification = await verifications.createFromDetection(
      detection.id,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    return (await verifications.update(verification.id, {
      private_evidence_thread_id: 'evidence-thread-1',
    }))!;
  }

  it('persists a frozen preview, resumable item outcomes, and aggregate completion', async () => {
    const verification = await createPendingCase();
    const job = await jobs.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: verification.id,
      requestedBy: 'administrator-1',
      actorSurface: 'web',
      mode: MessageDeletionJobMode.DELETE_ONLY,
      scope: MessageDeletionScope.LAST_DAY,
      reason: 'Repeated unsolicited links',
      evidenceThreadId: 'evidence-thread-1',
    });

    await expect(jobs.beginPreview(job.id)).resolves.toMatchObject({
      status: MessageDeletionJobStatus.DISCOVERING,
    });
    await jobs.replacePreview(job.id, {
      coverage: MessageDeletionCoverage.READY,
      requestedWindowStart: new Date('2026-07-14T12:00:00.000Z'),
      requestedWindowEnd: new Date('2026-07-15T12:00:00.000Z'),
      items: [
        {
          messageId: 'message-1',
          channelId: 'channel-1',
          authorId: 'user-1',
          messageCreatedAt: new Date('2026-07-15T10:00:00.000Z'),
          contentPreview: 'first message',
          attachmentCount: 0,
          discoverySource: MessageDeletionDiscoverySource.DISCORD_SEARCH,
          bulkDeleteEligible: true,
        },
        {
          messageId: 'message-2',
          channelId: 'channel-1',
          authorId: 'user-1',
          messageCreatedAt: new Date('2026-07-15T11:00:00.000Z'),
          contentPreview: 'second message',
          attachmentCount: 1,
          discoverySource: MessageDeletionDiscoverySource.DISCORD_SEARCH,
          bulkDeleteEligible: true,
        },
      ],
    });

    const execution = await jobs.beginExecution(job.id);
    expect(execution?.items).toHaveLength(2);
    const [first, second] = execution!.items;
    await jobs.markItemEvidencePreserved(first.id, 'evidence-message-1');
    await jobs.updateItemOutcome(first.id, {
      status: MessageDeletionItemStatus.DELETED,
      evidenceStatus: MessageDeletionEvidenceStatus.PRESERVED,
      evidenceMessageId: 'evidence-message-1',
      deletedAt: new Date(),
    });
    await jobs.updateItemOutcome(second.id, {
      status: MessageDeletionItemStatus.CHANGED_SINCE_PREVIEW,
      evidenceStatus: MessageDeletionEvidenceStatus.PENDING,
      failureReason: 'message_changed_since_preview',
    });
    await jobs.complete(job.id, {
      preservedCount: 1,
      deletedCount: 1,
      alreadyMissingCount: 0,
      changedCount: 1,
      evidenceFailedCount: 0,
      deleteFailedCount: 0,
      permissionDeniedCount: 0,
    });

    await expect(jobs.findById(job.id)).resolves.toMatchObject({
      status: MessageDeletionJobStatus.COMPLETED,
      candidate_count: 2,
      preserved_count: 1,
      deleted_count: 1,
      changed_count: 1,
      items: [
        expect.objectContaining({
          status: MessageDeletionItemStatus.DELETED,
          evidence_message_id: 'evidence-message-1',
        }),
        expect.objectContaining({ status: MessageDeletionItemStatus.CHANGED_SINCE_PREVIEW }),
      ],
    });
    await expect(
      prisma.verification_events.delete({ where: { id: verification.id } })
    ).rejects.toThrow();
  });

  it('cascades cleanup records when their server is deleted', async () => {
    const verification = await createPendingCase();
    const job = await jobs.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: verification.id,
      requestedBy: 'administrator-1',
      actorSurface: 'web',
      mode: MessageDeletionJobMode.DELETE_ONLY,
      scope: MessageDeletionScope.SOURCE_MESSAGE,
      reason: 'Remove the source message',
      evidenceThreadId: 'evidence-thread-1',
    });

    await prisma.servers.delete({ where: { guild_id: 'guild-1' } });

    await expect(jobs.findById(job.id)).resolves.toBeNull();
    await expect(
      prisma.verification_events.findUnique({ where: { id: verification.id } })
    ).resolves.toBeNull();
  });

  it('links cleanup action requests to their durable job', async () => {
    const verification = await createPendingCase();
    const job = await jobs.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: verification.id,
      requestedBy: 'administrator-1',
      actorSurface: 'web',
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
      scope: MessageDeletionScope.SOURCE_MESSAGE,
      reason: 'Remove the source message with the ban',
      evidenceThreadId: 'evidence-thread-1',
    });

    const request = await requests.enqueue({
      serverId: 'guild-1',
      actionType: ModerationActionRequestType.PREVIEW_CASE_MESSAGE_DELETION,
      actorId: 'administrator-1',
      actorSurface: 'web',
      targetUserId: 'user-1',
      verificationEventId: verification.id,
      messageDeletionJobId: job.id,
      idempotencyKey: `test:cleanup-preview:${job.id}`,
    });
    expect(request.message_deletion_job_id).toBe(job.id);

    await expect(requests.claimNext()).resolves.toMatchObject({
      id: request.id,
      status: ModerationActionRequestStatus.PROCESSING,
      message_deletion_job_id: job.id,
    });
  });

  it('serializes active moderation actions for the same case', async () => {
    const verification = await createPendingCase();
    const first = await requests.enqueue({
      serverId: 'guild-1',
      actionType: ModerationActionRequestType.REFRESH_CASE_NOTIFICATION,
      actorId: 'administrator-1',
      actorSurface: 'web',
      targetUserId: 'user-1',
      verificationEventId: verification.id,
      idempotencyKey: `test:first-case-action:${verification.id}`,
    });

    await expect(
      requests.enqueue({
        serverId: 'guild-1',
        actionType: ModerationActionRequestType.CLOSE_CASE_NO_ACTION,
        actorId: 'administrator-2',
        actorSurface: 'web',
        targetUserId: 'user-1',
        verificationEventId: verification.id,
        idempotencyKey: `test:second-case-action:${verification.id}`,
      })
    ).rejects.toThrow();

    await requests.complete(first.id);

    await expect(
      requests.enqueue({
        serverId: 'guild-1',
        actionType: ModerationActionRequestType.CLOSE_CASE_NO_ACTION,
        actorId: 'administrator-2',
        actorSurface: 'web',
        targetUserId: 'user-1',
        verificationEventId: verification.id,
        idempotencyKey: `test:second-case-action:${verification.id}`,
      })
    ).resolves.toMatchObject({
      status: ModerationActionRequestStatus.QUEUED,
      verification_event_id: verification.id,
    });
  });

  it('reclaims stale processing cleanup requests after a worker interruption', async () => {
    const verification = await createPendingCase();
    const job = await jobs.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: verification.id,
      requestedBy: 'administrator-1',
      actorSurface: 'web',
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
      scope: MessageDeletionScope.LAST_HOUR,
      reason: 'Ban and remove recent messages',
      evidenceThreadId: 'evidence-thread-1',
    });
    const request = await requests.enqueue({
      serverId: 'guild-1',
      actionType: ModerationActionRequestType.BAN_CASE_USER_WITH_MESSAGE_CLEANUP,
      actorId: 'administrator-1',
      actorSurface: 'web',
      targetUserId: 'user-1',
      verificationEventId: verification.id,
      messageDeletionJobId: job.id,
      idempotencyKey: `test:stale-cleanup:${job.id}`,
    });
    await prisma.$executeRaw`
      update moderation_action_requests
      set status = 'processing'::moderation_action_request_status,
          updated_at = now() - interval '16 minutes'
      where id = ${request.id}::uuid
    `;

    await expect(requests.claimNext()).resolves.toMatchObject({
      id: request.id,
      status: ModerationActionRequestStatus.PROCESSING,
      attempts: 1,
    });
  });
});
