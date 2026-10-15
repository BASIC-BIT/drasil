import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import {
  CaseKind,
  CaseAttentionState,
  CaseContainmentStatus,
  VerificationStatus,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('verification metadata patches (integration)', () => {
  it('preserves independent concurrent patches and current case state', async () => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-metadata');
    await new UserRepository(prisma).getOrCreateUser('user-metadata', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-metadata',
      'user-metadata',
      VerificationStatus.PENDING
    );
    const oldTime = new Date('2026-01-01T00:00:00Z');
    await repository.update(
      event.id,
      { metadata: { existing: true }, updated_at: oldTime },
      { touchUpdatedAt: false }
    );
    await Promise.all([
      repository.patchMetadata(
        event.id,
        { initial_verification_prompt_message_id: 'prompt-1' },
        { touchUpdatedAt: false }
      ),
      repository.patchMetadata(
        event.id,
        { member_left: { at: '2026-10-15' } },
        { touchUpdatedAt: false }
      ),
    ]);
    expect(await repository.findById(event.id)).toMatchObject({
      status: VerificationStatus.PENDING,
      updated_at: oldTime,
      metadata: {
        existing: true,
        initial_verification_prompt_message_id: 'prompt-1',
        member_left: { at: '2026-10-15' },
      },
    });
    expect(
      (await repository.patchMetadata(event.id, { existing: false }))?.updated_at.getTime()
    ).toBeGreaterThan(oldTime.getTime());
    expect(
      await repository.patchMetadata('00000000-0000-0000-0000-000000000000', { missing: true })
    ).toBeNull();
  });

  it('merges guarded departure metadata with concurrent evidence without changing unrelated state', async () => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-departure-patch');
    await new UserRepository(prisma).getOrCreateUser('user-departure-patch', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-departure-patch',
      'user-departure-patch',
      VerificationStatus.PENDING
    );
    await repository.update(event.id, {
      thread_id: 'thread-retained',
      notes: 'retained',
      metadata: { support_thread_reminder: { reminderCount: 1 } },
    });
    await Promise.all([
      repository.patchMetadata(event.id, { evidence_bundle: { detection_history_count: 2 } }),
      repository.updatePendingAfterMemberLeft(event.id, null, {
        metadata: { membership_state: 'left_or_removed' },
      }),
    ]);
    expect(await repository.findById(event.id)).toMatchObject({
      status: VerificationStatus.PENDING,
      thread_id: 'thread-retained',
      notes: 'retained',
      resolved_at: null,
      resolved_by: null,
      metadata: {
        support_thread_reminder: { reminderCount: 1 },
        evidence_bundle: { detection_history_count: 2 },
        membership_state: 'left_or_removed',
      },
    });
    await repository.update(event.id, { status: VerificationStatus.BANNED });
    expect(
      await repository.updatePendingAfterMemberLeft(event.id, null, {
        metadata: { forbidden: true },
      })
    ).toBeNull();
    expect((await repository.findById(event.id))?.metadata).not.toHaveProperty('forbidden');
  });

  it.each([
    ['terminal', VerificationStatus.BANNED],
    ['terminal_clear', VerificationStatus.BANNED],
    ['verification_release', VerificationStatus.VERIFIED],
    ['case_role_release', VerificationStatus.VERIFIED],
    ['quarantine', VerificationStatus.PENDING],
    ['recovery', VerificationStatus.PENDING],
  ])(
    'preserves concurrent metadata during guarded %s completion',
    async (operation, expectedStatus) => {
      const prisma = getPrismaClient();
      await new ServerRepository(prisma).getOrCreateServer('guild-guarded-patch');
      await new UserRepository(prisma).getOrCreateUser('user-guarded-patch', 'target');
      const repository = new VerificationEventRepository(prisma);
      const event = await repository.createFromDetection(
        null,
        'guild-guarded-patch',
        'user-guarded-patch',
        VerificationStatus.PENDING
      );
      const oldTime = new Date('2026-01-01T00:00:00Z');
      await repository.update(event.id, {
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: 'attempt-guarded',
        quarantine_lease_renewed_at: oldTime,
        metadata: {
          support_thread_reminder: { reminderCount: 1 },
          active_moderation_operation: { operationId: 'retained-operation' },
        },
      });
      const complete = async (attemptId: string): Promise<unknown> => {
        const metadata = { completion_owned: true };
        switch (operation) {
          case 'terminal':
          case 'terminal_clear':
            return repository.completeTerminalActions(
              [
                {
                  id: event.id,
                  metadata,
                  requiresTerminalActionClaim: true,
                  clearActiveModerationOperation: operation === 'terminal_clear',
                },
              ],
              attemptId,
              VerificationStatus.BANNED,
              'moderator',
              new Date(),
              'Decision'
            );
          case 'verification_release':
            return repository.completeVerificationRelease(
              [{ id: event.id, metadata, requiresCaseRoleReleaseClaim: true }],
              attemptId,
              'moderator',
              new Date()
            );
          case 'case_role_release':
            return repository.completeCaseRoleRelease(
              event.id,
              attemptId,
              'moderator',
              new Date(),
              metadata
            );
          case 'quarantine':
            return repository.updateQuarantineAttempt(event.id, attemptId, {
              metadata,
              containment_status: CaseContainmentStatus.CONTAINED,
            });
          case 'recovery':
            return repository.recoverExpiredQuarantineAttempt(event.id, attemptId, new Date(), {
              metadata,
              containment_status: CaseContainmentStatus.INCOMPLETE,
            });
          default:
            throw new Error('Unsupported fixture');
        }
      };
      expect(await complete('wrong-owner')).toBeNull();
      await Promise.all([
        complete('attempt-guarded'),
        repository.patchMetadata(event.id, {
          membership_state: 'left_or_removed',
          evidence_bundle: { detection_history_count: 2 },
        }),
      ]);
      expect(await repository.findById(event.id)).toMatchObject({
        status: expectedStatus,
        quarantine_attempt_id: null,
        metadata: {
          support_thread_reminder: { reminderCount: 1 },
          completion_owned: true,
          membership_state: 'left_or_removed',
          evidence_bundle: { detection_history_count: 2 },
        },
      });
      const latest = await repository.findById(event.id);
      if (operation === 'terminal_clear')
        expect(latest?.metadata).not.toHaveProperty('active_moderation_operation');
      else
        expect(latest?.metadata).toHaveProperty(
          'active_moderation_operation.operationId',
          'retained-operation'
        );
    }
  );

  it('atomically stores thread identity and type while preserving concurrent metadata and lifecycle state', async () => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-thread-identity');
    await new UserRepository(prisma).getOrCreateUser('user-thread-identity', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-thread-identity',
      'user-thread-identity',
      VerificationStatus.PENDING
    );
    await repository.update(event.id, {
      status: VerificationStatus.CLOSED_NO_ACTION,
      metadata: { retained: true, thread_type: 'report_review' },
    });
    await Promise.all([
      repository.setThreadIdentity(event.id, 'verification-thread', 'verification', {
        routing: { added: true },
        thread_type: 'report_review',
      }),
      repository.patchMetadata(event.id, { member_left: true }),
    ]);
    expect(await repository.findById(event.id)).toMatchObject({
      thread_id: 'verification-thread',
      status: VerificationStatus.CLOSED_NO_ACTION,
      metadata: {
        retained: true,
        thread_type: 'verification',
        routing: { added: true },
        member_left: true,
      },
    });
    expect(
      await repository.setThreadIdentity(
        '00000000-0000-0000-0000-000000000000',
        'missing',
        'verification'
      )
    ).toBeNull();
  });

  it('leaves the old thread identity intact if Postgres rejects the type update', async () => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-thread-failure');
    await new UserRepository(prisma).getOrCreateUser('user-thread-failure', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-thread-failure',
      'user-thread-failure',
      VerificationStatus.PENDING
    );
    await repository.update(event.id, {
      thread_id: 'legacy-review',
      metadata: { thread_type: 'report_review', retained: true },
    });
    // Dedicated disposable local DB only. A real constraint failure proves the
    // UPDATE cannot persist the thread ID while rejecting its metadata change.
    await prisma.$executeRaw`ALTER TABLE verification_events ADD CONSTRAINT task1_thread_type_failure CHECK (metadata->>'thread_type' IS DISTINCT FROM 'verification') NOT VALID`;
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        repository.setThreadIdentity(event.id, 'new-thread', 'verification')
      ).rejects.toThrow();
      expect(await repository.findById(event.id)).toMatchObject({
        thread_id: 'legacy-review',
        metadata: { thread_type: 'report_review', retained: true },
      });
    } finally {
      await prisma.$executeRaw`ALTER TABLE verification_events DROP CONSTRAINT task1_thread_type_failure`;
      error.mockRestore();
    }
  });

  it.each([null, [], 'old-value'])('initializes non-object metadata (%j)', async (metadata) => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-metadata');
    await new UserRepository(prisma).getOrCreateUser('user-metadata', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-metadata',
      'user-metadata',
      VerificationStatus.PENDING
    );
    if (metadata !== null) await repository.update(event.id, { metadata });
    expect((await repository.patchMetadata(event.id, { prompt: 'message-1' }))?.metadata).toEqual({
      prompt: 'message-1',
    });
  });
});
