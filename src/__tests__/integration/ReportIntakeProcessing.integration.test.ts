import { processingMetadata } from '../../repositories/reportIntakeProcessing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { InMemoryReportIntakeRepository } from '../fakes/inMemoryRepositories';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ReportIntakeStatus, ReportIntakeEvidenceKind } from '../../repositories/types';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const now = new Date('2026-11-03T00:00:00.000Z');
const due = new Date('2026-11-03T00:00:15.000Z');
const outcome = {
  kind: 'admin_review' as const,
  reason: 'no_match' as const,
  candidates: [],
  coverage: { kind: 'unavailable' as const, reason: 'transport' as const },
  includedEvidenceIds: [],
  excludedEvidenceIds: [],
};

describeIntegration('durable report intake processing', () => {
  async function fixture(metadata: Record<string, unknown> = { unrelated: 'kept' }) {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-processing');
    await new UserRepository(prisma).getOrCreateUser('reporter-processing', 'reporter', now);
    const repository = new ReportIntakeRepository(prisma);
    const intake = await repository.create({
      serverId: 'guild-processing',
      reporterId: 'reporter-processing',
      metadata,
    });
    const batch = {
      intakeId: intake.id,
      sourceMessageId: 'message',
      sourceChannelId: 'thread',
      sourceAuthorId: 'reporter-processing',
      sourceVersion: 1,
      sourceFingerprint: 'v1',
      observedAt: now,
      editedAt: null,
      operation: 'upsert' as const,
      evidence: [
        {
          kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
          content: 'evidence',
          metadata: { retained: true },
        },
      ],
    };
    return { prisma, repository, intake, batch };
  }

  it('does not schedule an old row with no due time', async () => {
    const { repository, intake } = await fixture();
    expect(await repository.findById(intake.id)).toMatchObject({
      evidence_revision: 0,
      analysis_revision: 0,
      analysis_due_at: null,
    });
    expect(await repository.claimAnalysis(due, 10_000)).toBeNull();
  });

  it('records a batch atomically and deduplicates its revision', async () => {
    const { repository, intake, batch } = await fixture();
    expect(await repository.recordEvidenceBatch(batch)).toBe('recorded');
    const initial = await repository.findById(intake.id);
    const initialRevision = initial?.evidence_revision;
    expect(await repository.recordEvidenceBatch(batch)).toBe('duplicate');
    const duplicateRevision = (await repository.findById(intake.id))?.evidence_revision;
    expect(duplicateRevision).toBe(initialRevision);
    expect(initial).toMatchObject({
      evidence_revision: 1,
      analysis_due_at: due,
      metadata: { unrelated: 'kept' },
    });
    expect(await repository.listEvidence(intake.id)).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ retained: true, sourceVersion: 1 }),
      }),
    ]);
  });

  it('atomically rejects cached recovery after a newer unavailable observation', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    await repository.recordEvidenceBatch({
      ...batch,
      availability: 'unavailable',
      evidence: [],
      observedAt: due,
    });
    const unavailable = await repository.findById(intake.id);
    expect(await repository.recordEvidenceBatch(batch)).toBe('stale');
    expect(await repository.findById(intake.id)).toEqual(unavailable);
  });

  it('recovers source availability without changing semantic version or duplicating history', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    await repository.recordEvidenceBatch({
      ...batch,
      availability: 'unavailable',
      evidence: [],
      observedAt: due,
    });
    expect(await repository.findById(intake.id)).toMatchObject({
      evidence_revision: 2,
      metadata: {
        analysis: { sources: { message: { availability: 'unavailable', sourceVersion: 1 } } },
      },
    });
    const unavailable = (await repository.findById(intake.id))!;
    const recoveryToken =
      processingMetadata(unavailable).analysis.sources.message.availabilityFailureToken!;
    await repository.recordEvidenceBatch({ ...batch, recoveryToken });
    expect(await repository.listEvidence(intake.id)).toHaveLength(1);
    expect(await repository.findById(intake.id)).toMatchObject({
      evidence_revision: 3,
      metadata: {
        analysis: { sources: { message: { availability: 'available', sourceVersion: 1 } } },
      },
    });
  });

  it('invalidates an older recovery token on repeated failures without resetting investigation state', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    const failed = {
      ...batch,
      availability: 'unavailable' as const,
      evidence: [],
      observedAt: due,
    };
    await repository.recordEvidenceBatch(failed);
    const first = (await repository.findById(intake.id))!;
    const oldToken = processingMetadata(first).analysis.sources.message.availabilityFailureToken!;
    const claimAt = first.analysis_due_at!;
    const claim = (await repository.claimAnalysis(claimAt, 10_000))!;
    await repository.reserveModelAttempt(claim, claimAt);
    const beforeRepeat = (await repository.findById(intake.id))!;
    expect(await repository.recordEvidenceBatch(failed)).toBe('duplicate');
    const afterRepeat = (await repository.findById(intake.id))!;
    const currentToken =
      processingMetadata(afterRepeat).analysis.sources.message.availabilityFailureToken!;
    expect(currentToken).not.toBe(oldToken);
    expect(afterRepeat).toMatchObject({
      evidence_revision: beforeRepeat.evidence_revision,
      analysis_attempts: 1,
      analysis_due_at: beforeRepeat.analysis_due_at,
      analysis_deadline_at: beforeRepeat.analysis_deadline_at,
      analysis_lease_token: beforeRepeat.analysis_lease_token,
    });
    expect(await repository.recordEvidenceBatch({ ...batch, recoveryToken: oldToken })).toBe(
      'stale'
    );
    expect(await repository.findById(intake.id)).toEqual(afterRepeat);
    expect(await repository.recordEvidenceBatch({ ...batch, recoveryToken: currentToken })).toBe(
      'recorded'
    );
    expect(await repository.listEvidence(intake.id)).toHaveLength(1);
  });

  it('uses configured scheduling in the production and in-memory repositories', async () => {
    const { repository, prisma, intake, batch } = await fixture();
    const serverRepository = new ServerRepository(prisma);
    await prisma.servers.update({
      where: { guild_id: intake.server_id },
      data: { settings: { report_intake_agent_debounce_ms: 5000 } },
    });
    const fake = new InMemoryReportIntakeRepository(serverRepository);
    const fakeIntake = await fake.create({
      serverId: intake.server_id,
      reporterId: intake.reporter_id,
    });
    await repository.recordEvidenceBatch(batch);
    await fake.recordEvidenceBatch({ ...batch, intakeId: fakeIntake.id });
    const configuredDue = new Date('2026-11-03T00:00:05.000Z');
    expect(await repository.findById(intake.id)).toMatchObject({ analysis_due_at: configuredDue });
    expect(await fake.findById(fakeIntake.id)).toMatchObject({ analysis_due_at: configuredDue });
  });

  it('keeps an unknown deletion out of investigation revisions, budgets and prompts', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    const claim = (await repository.claimAnalysis(due, 10_000))!;
    await repository.reserveModelAttempt(claim, due);
    const before = (await repository.findById(intake.id))!;
    await repository.recordEvidenceBatch({
      ...batch,
      sourceMessageId: 'unseen',
      sourceAuthorId: null,
      operation: 'delete',
      evidence: [],
      observedAt: due,
    });
    expect(await repository.findById(intake.id)).toMatchObject({
      evidence_revision: before.evidence_revision,
      analysis_attempts: 1,
      analysis_lease_token: before.analysis_lease_token,
      analysis_deadline_at: before.analysis_deadline_at,
      analysis_due_at: before.analysis_due_at,
      metadata: {
        analysis: { sources: { unseen: { operation: 'delete', sourceAuthorId: null } } },
      },
    });
    expect(await repository.recordEvidenceBatch({ ...batch, sourceMessageId: 'unseen' })).toBe(
      'stale'
    );
    expect(await repository.listEvidence(intake.id)).toHaveLength(1);
  });

  it('retains the persisted author when a delete was observed before the first commit', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    await repository.recordEvidenceBatch({
      ...batch,
      sourceAuthorId: null,
      sourceVersion: 0,
      operation: 'delete',
      evidence: [],
    });
    expect(await repository.findById(intake.id)).toMatchObject({
      metadata: {
        analysis: {
          sources: {
            message: {
              sourceAuthorId: 'reporter-processing',
              sourceVersion: 1,
              operation: 'delete',
            },
          },
        },
      },
    });
  });

  it('allows only one claim for a revision', async () => {
    const { repository, batch } = await fixture();
    expect(await repository.recordEvidenceBatch(batch)).toBe('recorded');
    const claims = await Promise.all([
      repository.claimAnalysis(due, 10_000),
      repository.claimAnalysis(due, 10_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('rejects completion from an old revision', async () => {
    const { repository, batch } = await fixture();
    expect(await repository.recordEvidenceBatch(batch)).toBe('recorded');
    const claim = await repository.claimAnalysis(due, 10_000);
    await repository.recordEvidenceBatch({
      ...batch,
      sourceVersion: 2,
      sourceFingerprint: 'v2',
      editedAt: due,
      observedAt: due,
    });
    const staleCompletion = await repository.completeAnalysis(claim!, outcome, due);
    expect(staleCompletion).toBe(false);
    const oldCompletion = staleCompletion;
    expect(oldCompletion).toBe(false);
  });

  it('persists the deadline and two-request allowance across lease recovery', async () => {
    const { repository, intake, batch } = await fixture();
    expect(await repository.recordEvidenceBatch(batch)).toBe('recorded');
    const first = await repository.claimAnalysis(due, 1_000);
    expect(await repository.reserveModelAttempt(first!, due)).toBe(true);
    const recoveredAt = new Date(due.getTime() + 1_001);
    const second = await repository.claimAnalysis(recoveredAt, 10_000);
    expect(second).toMatchObject({ attempts: 1, deadline: new Date('2026-11-03T00:01:00.000Z') });
    expect(await repository.reserveModelAttempt(first!, recoveredAt)).toBe(false);
    expect(await repository.renewAnalysisLease(first!, recoveredAt, 10_000)).toBe(false);
    expect(await repository.reserveModelAttempt(second!, recoveredAt)).toBe(true);
    expect(await repository.reserveModelAttempt(second!, recoveredAt)).toBe(false);
    expect(await repository.findById(intake.id)).toMatchObject({ analysis_attempts: 2 });
  });

  it('does not clear evidence or malformed metadata', async () => {
    const { repository, intake, batch } = await fixture({
      analysis: { schemaVersion: 1, sources: 'broken' },
    });
    await repository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
      content: 'original',
    });
    expect(repository.recordEvidenceBatch).toEqual(expect.any(Function));
    await expect(repository.recordEvidenceBatch(batch)).rejects.toThrow();
    expect(await repository.listEvidence(intake.id)).toEqual([
      expect.objectContaining({ content: 'original' }),
    ]);
    expect(await repository.findById(intake.id)).toMatchObject({
      metadata: { analysis: { sources: 'broken' } },
    });
  });
  it('preserves old rows and leaves them idle when the actual migration is applied', async () => {
    const prisma = getPrismaClient();
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        'CREATE TEMP TABLE report_intakes (id text, status text, metadata jsonb) ON COMMIT DROP'
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO report_intakes VALUES ('old', 'collecting_evidence', '{"kept":true}')`
      );
      const migration = readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20261103000000_report_intake_processing/migration.sql'
        ),
        'utf8'
      );
      for (const statement of migration.split(';').filter((part) => part.trim()))
        await transaction.$executeRawUnsafe(statement);
      const rows = await transaction.$queryRaw<
        Array<Record<string, unknown>>
      >`SELECT * FROM report_intakes`;
      expect(rows).toEqual([
        expect.objectContaining({
          id: 'old',
          metadata: { kept: true },
          evidence_revision: 0,
          analysis_revision: 0,
          analysis_due_at: null,
          analysis_attempts: 0,
        }),
      ]);
    });
  });

  it('keeps tombstones authoritative over delayed upserts without deleting saved evidence', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    expect(
      await repository.recordEvidenceBatch({
        ...batch,
        sourceVersion: 2,
        sourceFingerprint: 'deleted',
        operation: 'delete',
        evidence: [],
      })
    ).toBe('recorded');
    expect(
      await repository.recordEvidenceBatch({
        ...batch,
        sourceVersion: 3,
        sourceFingerprint: 'late',
      })
    ).toBe('stale');
    expect(await repository.listEvidence(intake.id)).toHaveLength(1);
    expect(await repository.findById(intake.id)).toMatchObject({ evidence_revision: 2 });
  });

  it('caps batching delay and preserves start throttling when new evidence supersedes work', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    for (const seconds of [14, 28])
      await repository.recordEvidenceBatch({
        ...batch,
        sourceVersion: seconds,
        sourceFingerprint: String(seconds),
        observedAt: new Date(now.getTime() + seconds * 1000),
      });
    expect(await repository.findById(intake.id)).toMatchObject({
      analysis_due_at: new Date('2026-11-03T00:00:30.000Z'),
    });
    const claim = await repository.claimAnalysis(new Date('2026-11-03T00:00:30.000Z'), 20_000);
    expect(claim).not.toBeNull();
    await repository.reserveModelAttempt(claim!, new Date('2026-11-03T00:00:30.000Z'));
    await repository.recordEvidenceBatch({
      ...batch,
      sourceVersion: 40,
      sourceFingerprint: 'v40',
      observedAt: new Date('2026-11-03T00:00:40.000Z'),
    });
    expect(await repository.findById(intake.id)).toMatchObject({
      analysis_attempts: 0,
      analysis_deadline_at: null,
      analysis_started_at: new Date('2026-11-03T00:00:30.000Z'),
      analysis_due_at: new Date('2026-11-03T00:01:30.000Z'),
    });
  });

  it('does not reserve requests after the persisted deadline or a confirmed target', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    const claim = await repository.claimAnalysis(due, 120_000);
    expect(await repository.reserveModelAttempt(claim!, new Date('2026-11-03T00:01:00.000Z'))).toBe(
      false
    );
    await repository.update(intake.id, { confirmedTargetUserId: 'target' });
    expect(await repository.reserveModelAttempt(claim!, due)).toBe(false);
    expect(await repository.completeAnalysis(claim!, outcome, due)).toBe(false);
  });

  it('preserves current delivery and acknowledgement fields when completing analysis', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    const claim = await repository.claimAnalysis(due, 10_000);
    const current = await repository.findById(intake.id);
    const metadata = current!.metadata as Record<string, unknown>;
    await repository.update(intake.id, {
      metadata: {
        ...metadata,
        concurrentlyAdded: 'kept',
        analysis: {
          ...(metadata.analysis as Record<string, unknown>),
          handoff: {
            state: 'acknowledged',
            reason: 'rejected',
            messageId: 'delivered-message',
            channelId: 'queue-channel',
            attempts: 1,
            nextDueAt: null,
            receipt: 'sent',
            acknowledgedBy: 'moderator',
            acknowledgedAt: due.toISOString(),
            presentationLease: 'owned-by-presentation',
          },
        },
      },
    });
    expect(await repository.completeAnalysis(claim!, outcome, due)).toBe(true);
    expect(await repository.findById(intake.id)).toMatchObject({
      status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
      metadata: {
        concurrentlyAdded: 'kept',
        analysis: {
          handoff: {
            state: 'acknowledged',
            reason: 'rejected',
            messageId: 'delivered-message',
            acknowledgedBy: 'moderator',
            presentationLease: 'owned-by-presentation',
          },
        },
      },
    });
  });

  it('claims confirmation timeout without spending provider budget', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    const claim = await repository.claimAnalysis(due, 10_000);
    const candidate = {
      candidateId: 'candidate',
      discordUserId: 'user',
      serverId: 'guild-processing',
      username: 'name',
      globalName: null,
      nickname: null,
      displayName: 'name',
      avatarUrl: null,
      subjectId: 'subject',
      sourceRefs: [],
      matchedFields: ['userId' as const],
    };
    expect(
      await repository.completeAnalysis(claim!, { ...outcome, kind: 'confirm', candidate }, due)
    ).toBe(true);
    const timeoutAt = new Date('2026-11-03T00:10:15.000Z');
    expect(await repository.claimAnalysis(new Date(timeoutAt.getTime() - 1), 10_000)).toBeNull();
    const timeout = await repository.claimAnalysis(timeoutAt, 10_000);
    expect(timeout?.kind).toBe('confirmation_timeout');
    expect(await repository.findById(intake.id)).toMatchObject({
      analysis_deadline_at: new Date('2026-11-03T00:01:00.000Z'),
    });
    expect(await repository.reserveModelAttempt(timeout!, timeoutAt)).toBe(false);
    expect(await repository.completeAnalysis(timeout!, outcome, timeoutAt)).toBe(true);
    expect(await repository.findById(intake.id)).toMatchObject({
      analysis_due_at: null,
      metadata: {
        analysis: { outcome: { reason: 'confirmation_timeout' }, handoff: { state: 'pending' } },
      },
    });
  });

  it('retains post-submission evidence without rescheduling or retargeting', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.update(intake.id, {
      status: ReportIntakeStatus.SUBMITTED,
      confirmedTargetUserId: 'target',
    });
    expect(await repository.recordEvidenceBatch(batch)).toBe('recorded');
    expect(await repository.findById(intake.id)).toMatchObject({
      status: ReportIntakeStatus.SUBMITTED,
      confirmed_target_user_id: 'target',
      evidence_revision: 1,
      analysis_due_at: null,
    });
    await repository.update(intake.id, { closedAt: due });
    expect(
      await repository.recordEvidenceBatch({ ...batch, sourceVersion: 2, sourceFingerprint: 'v2' })
    ).toBe('closed');
  });

  it('keeps the in-memory repository processing behavior aligned', async () => {
    const { intake, batch } = await fixture();
    const fake = new InMemoryReportIntakeRepository();
    const fakeIntake = await fake.create({
      serverId: intake.server_id,
      reporterId: intake.reporter_id,
    });
    const fakeBatch = { ...batch, intakeId: fakeIntake.id };
    expect(await fake.recordEvidenceBatch(fakeBatch)).toBe('recorded');
    expect(await fake.recordEvidenceBatch(fakeBatch)).toBe('duplicate');
    const claims = await Promise.all([
      fake.claimAnalysis(due, 10_000),
      fake.claimAnalysis(due, 10_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await fake.reserveModelAttempt(claims.find(Boolean)!, due)).toBe(true);
    expect(await fake.completeAnalysis(claims.find(Boolean)!, outcome, due)).toBe(true);
    expect(await fake.findById(fakeIntake.id)).toMatchObject({
      analysis_revision: 1,
      analysis_attempts: 1,
      status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
    });
  });
  it('rejects confirmation after handoff and preserves the original handoff reason through edits', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch(batch);
    let claim = await repository.claimAnalysis(due, 10_000);
    expect(await repository.completeAnalysis(claim!, { ...outcome, reason: 'rejected' }, due)).toBe(
      true
    );
    const current = await repository.findById(intake.id);
    const metadata = current!.metadata as Record<string, unknown>;
    await repository.update(intake.id, {
      metadata: {
        ...metadata,
        analysis: {
          ...(metadata.analysis as Record<string, unknown>),
          handoff: {
            state: 'acknowledged',
            reason: 'rejected',
            messageId: 'message',
            channelId: 'queue',
            attempts: 1,
            nextDueAt: null,
            receipt: 'sent',
            acknowledgedBy: 'moderator',
            acknowledgedAt: due.toISOString(),
          },
        },
      },
    });
    const editedAt = new Date('2026-11-03T00:00:20.000Z');
    await repository.recordEvidenceBatch({
      ...batch,
      sourceVersion: 2,
      sourceFingerprint: 'edited',
      observedAt: editedAt,
    });
    const secondDue = new Date('2026-11-03T00:01:15.000Z');
    claim = await repository.claimAnalysis(secondDue, 10_000);
    const candidate = {
      candidateId: 'candidate',
      discordUserId: 'user',
      serverId: 'guild-processing',
      username: 'name',
      globalName: null,
      nickname: null,
      displayName: 'name',
      avatarUrl: null,
      subjectId: 'subject',
      sourceRefs: [],
      matchedFields: ['userId' as const],
    };
    expect(
      await repository.completeAnalysis(
        claim!,
        { ...outcome, kind: 'confirm', candidate },
        secondDue
      )
    ).toBe(false);
    expect(await repository.findById(intake.id)).toMatchObject({
      status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
      metadata: {
        analysis: {
          handoff: {
            state: 'acknowledged',
            reason: 'rejected',
            acknowledgedBy: 'moderator',
            messageId: 'message',
          },
        },
      },
    });
  });
  it('tombstones an authorized deletion despite clock ordering and ignores repeated deletes', async () => {
    const { repository, intake, batch } = await fixture();
    await repository.recordEvidenceBatch({ ...batch, sourceVersion: 10 });
    expect(
      await repository.recordEvidenceBatch({
        ...batch,
        operation: 'delete',
        sourceVersion: 2,
        sourceFingerprint: 'deleted',
        evidence: [],
      })
    ).toBe('recorded');
    expect(
      await repository.recordEvidenceBatch({
        ...batch,
        operation: 'delete',
        sourceVersion: 20,
        sourceFingerprint: 'delete-replay',
        evidence: [],
      })
    ).toBe('duplicate');
    expect(
      await repository.recordEvidenceBatch({
        ...batch,
        sourceVersion: 30,
        sourceFingerprint: 'late-upsert',
      })
    ).toBe('stale');
    expect(await repository.findById(intake.id)).toMatchObject({
      evidence_revision: 2,
      metadata: { analysis: { sources: { message: { operation: 'delete', sourceVersion: 10 } } } },
    });
  });
  it.each([
    { analysis: { schemaVersion: 1, sources: 'broken' }, unrelated: 'preserved' },
    ['malformed-root'],
  ])('quarantines malformed earliest-due metadata and claims valid work: %j', async (metadata) => {
    const { prisma, repository, intake } = await fixture();
    await repository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
      content: 'original evidence',
    });
    const evidence = await repository.listEvidence(intake.id);
    await prisma.report_intakes.update({
      where: { id: intake.id },
      data: {
        metadata,
        evidence_revision: 1,
        analysis_due_at: now,
        analysis_started_at: now,
        analysis_deadline_at: new Date('2026-11-03T00:00:45.000Z'),
        analysis_attempts: 1,
      },
    });
    const valid = await fixture();
    await repository.recordEvidenceBatch(valid.batch);

    await expect(repository.claimAnalysis(due, 10_000)).resolves.toMatchObject({
      intake: { id: valid.intake.id },
    });
    const quarantined = await repository.findById(intake.id);
    expect(quarantined).toMatchObject({
      status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
      analysis_failure_code: 'invalid_metadata',
      analysis_deadline_at: new Date('2026-11-03T00:00:45.000Z'),
      analysis_attempts: 1,
      analysis_due_at: null,
      analysis_lease_token: null,
      analysis_lease_until: null,
      updated_at: due,
    });
    expect(quarantined?.metadata).toEqual(metadata);
    expect(await repository.listEvidence(intake.id)).toEqual(evidence);
    expect(await repository.claimAnalysis(due, 10_000)).toBeNull();
    expect(await repository.findById(intake.id)).toEqual(quarantined);
  });

  it('keeps malformed-row quarantine parity in the fake', async () => {
    const fake = new InMemoryReportIntakeRepository();
    const { batch } = await fixture();
    const bad = await fake.create({
      serverId: 'guild-processing',
      reporterId: 'reporter-processing',
    });
    await fake.recordEvidenceBatch({
      ...batch,
      intakeId: bad.id,
      observedAt: new Date(now.getTime() - 1000),
    });
    const evidence = await fake.listEvidence(bad.id);
    const metadata = { analysis: { schemaVersion: 1, sources: 'broken' }, unrelated: true };
    await fake.update(bad.id, { metadata });
    const valid = await fake.create({
      serverId: 'guild-processing',
      reporterId: 'reporter-processing',
    });
    await fake.recordEvidenceBatch({ ...batch, intakeId: valid.id });

    await expect(fake.claimAnalysis(due, 10_000)).resolves.toMatchObject({
      intake: { id: valid.id },
    });
    expect(await fake.findById(bad.id)).toMatchObject({
      analysis_failure_code: 'invalid_metadata',
      analysis_due_at: null,
      metadata,
    });
    expect(await fake.listEvidence(bad.id)).toEqual(evidence);
  });
  it('bounds quarantine scanning and continues progress on the next claim', async () => {
    const fake = new InMemoryReportIntakeRepository();
    const { batch } = await fixture();
    const badIds: string[] = [];
    for (let index = 0; index < 11; index++) {
      const bad = await fake.create({
        serverId: 'guild-processing',
        reporterId: 'reporter-processing',
      });
      badIds.push(bad.id);
      await fake.recordEvidenceBatch({
        ...batch,
        intakeId: bad.id,
        observedAt: new Date(now.getTime() - 1000),
      });
      await fake.update(bad.id, { metadata: { analysis: 'broken' } });
    }
    const valid = await fake.create({
      serverId: 'guild-processing',
      reporterId: 'reporter-processing',
    });
    await fake.recordEvidenceBatch({ ...batch, intakeId: valid.id });
    expect(await fake.claimAnalysis(due, 10_000)).toBeNull();
    const firstPass = await Promise.all(badIds.map((id) => fake.findById(id)));
    expect(
      firstPass.filter((intake) => intake?.analysis_failure_code === 'invalid_metadata')
    ).toHaveLength(10);
    await expect(fake.claimAnalysis(due, 10_000)).resolves.toMatchObject({
      intake: { id: valid.id },
    });
  });
});
