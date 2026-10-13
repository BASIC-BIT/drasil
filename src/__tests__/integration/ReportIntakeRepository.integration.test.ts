import type { IThreadManager } from '../../services/ThreadManager';
import type { IConfigService } from '../../config/ConfigService';
import type { IReportCandidateService } from '../../services/ReportCandidateService';
import { ReportIntakeService } from '../../services/ReportIntakeService';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { Prisma } from '../../db/prisma';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ReportIntakeStatus } from '../../repositories/types';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
describeIntegration('ReportIntakeRepository conditional state (integration)', () => {
  it('rejects a confirmation after its metadata snapshot changes', async () => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-copy');
    await new UserRepository(prisma).getOrCreateUser(
      'reporter-copy',
      'reporter',
      new Date('2020-01-01')
    );
    const repository = new ReportIntakeRepository(prisma);
    const intake = await repository.create({
      serverId: 'guild-copy',
      reporterId: 'reporter-copy',
      status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
      metadata: { prompt: 'old' },
    });
    const selection = {
      targetUserId: 'target-copy',
      expectedMetadata: intake.metadata,
      metadata: { prompt: 'old', confirmed_by: 'reporter-copy' },
    };
    await repository.update(intake.id, { metadata: { prompt: 'new' } });
    expect(await repository.confirmTargetIfUnset(intake.id, selection)).toBeNull();
    expect(await repository.findById(intake.id)).toMatchObject({
      confirmed_target_user_id: null,
      metadata: { prompt: 'new' },
    });
  });
  async function pending() {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-copy');
    await new UserRepository(prisma).getOrCreateUser(
      'reporter-copy',
      'reporter',
      new Date('2020-01-01')
    );
    const repository = new ReportIntakeRepository(prisma);
    const intake = await repository.create({
      serverId: 'guild-copy',
      reporterId: 'reporter-copy',
      status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
      metadata: { a: 1, b: 2 },
    });
    return { prisma, repository, intake };
  }

  it.each([true, false])(
    'only one of confirmation and rejection commits, confirmation first: %s',
    async (confirmationFirst) => {
      const { repository, intake } = await pending();
      const select = () =>
        repository.confirmTargetIfUnset(intake.id, {
          targetUserId: 'target-copy',
          expectedMetadata: intake.metadata,
          metadata: { selected: true },
        });
      const reject = () =>
        repository.updateIfCurrent(intake, {
          status: ReportIntakeStatus.COLLECTING_EVIDENCE,
          metadata: { rejected: true },
        });
      const results = await Promise.all(
        confirmationFirst ? [select(), reject()] : [reject(), select()]
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const stored = await repository.findById(intake.id);
      if (stored?.confirmed_target_user_id) {
        expect(stored.confirmed_target_user_id).toBe('target-copy');
        expect(stored.status).toBe(ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION);
      } else {
        expect(stored?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
        expect(stored?.metadata).toEqual({ rejected: true });
      }
    }
  );

  it.each([true, false])(
    'submission and thread-close writes retain both outcomes, submit first: %s',
    async (submissionFirst) => {
      const { prisma, repository, intake } = await pending();
      await repository.update(intake.id, { confirmedTargetUserId: 'target-copy' });
      await prisma.report_intakes.update({
        where: { id: intake.id },
        data: { thread_id: 'thread-copy' },
      });
      const service = new ReportIntakeService(
        repository,
        new ServerRepository(prisma),
        new UserRepository(prisma),
        new ServerMemberRepository(prisma),
        {} as IConfigService,
        {} as IReportCandidateService,
        {
          retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined),
        } as unknown as IThreadManager
      );
      const submit = () =>
        service.markSubmitted({
          intakeId: intake.id,
          targetUserId: 'target-copy',
          submittedById: 'reporter-copy',
        });
      const close = () =>
        service.closeIntakeForThread({ threadId: 'thread-copy', closedById: 'reporter-copy' });
      const results = await Promise.all(
        submissionFirst ? [submit(), close()] : [close(), submit()]
      );
      expect(results).toContain(true);
      expect(results).toContainEqual(expect.objectContaining({ closed: true }));
      expect(await repository.findById(intake.id)).toMatchObject({
        status: ReportIntakeStatus.SUBMITTED,
        confirmed_target_user_id: 'target-copy',
        metadata: { submitted_by: 'reporter-copy', thread_closed_by: 'reporter-copy' },
      });
    }
  );

  it('compares JSON snapshots independently of object key order', async () => {
    const { repository, intake } = await pending();
    expect(
      await repository.updateIfCurrent(
        { ...intake, metadata: { b: 2, a: 1 } },
        { summary: 'retained' }
      )
    ).toMatchObject({ summary: 'retained' });
    expect(await repository.updateIfCurrent(intake, { metadata: { a: 3 } })).not.toBeNull();
    expect(await repository.updateIfCurrent(intake, { summary: 'stale' })).toBeNull();
  });

  it.each([Prisma.DbNull, Prisma.JsonNull])(
    'handles a null metadata snapshot: %s',
    async (nullValue) => {
      const { prisma, repository, intake } = await pending();
      await prisma.report_intakes.update({
        where: { id: intake.id },
        data: { metadata: nullValue },
      });
      const snapshot = await repository.findById(intake.id);
      if (!snapshot) throw new Error('Fixture intake missing');
      expect(snapshot.metadata).toBeNull();
      expect(
        await repository.updateIfCurrent(snapshot, { metadata: { legacy: true } })
      ).toMatchObject({ metadata: { legacy: true } });
      expect(await repository.updateIfCurrent(snapshot, { summary: 'stale null' })).toBeNull();
    }
  );

  it('rejects an old unconfirmed snapshot after a selection reserves the report', async () => {
    const { repository, intake } = await pending();
    await repository.confirmTargetIfUnset(intake.id, {
      targetUserId: 'target-copy',
      expectedMetadata: intake.metadata,
      metadata: intake.metadata as Record<string, unknown>,
    });
    expect(
      await repository.updateIfCurrent(intake, { status: ReportIntakeStatus.CLOSED_BY_REPORTER })
    ).toBeNull();
    expect(await repository.findById(intake.id)).toMatchObject({
      status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
      confirmed_target_user_id: 'target-copy',
    });
  });
});
