import { Pool } from 'pg';
import { insertModerationActionRequestWithReceipt } from '../../../apps/web/lib/moderationActionRequestQueue';
import { getPrismaClient } from '../testDb';
import {
  ModerationActionRequestRepository,
  getReportBanAttemptToken,
} from '../../repositories/ModerationActionRequestRepository';
import {
  ModerationActionRequestCreate,
  ModerationActionRequestType,
} from '../../repositories/types';

jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration.each(['prisma', 'pg'] as const)('enqueue contract: %s', (client) => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  async function fixture() {
    const prisma = getPrismaClient();
    const repository = new ModerationActionRequestRepository(prisma);
    await prisma.servers.create({ data: { guild_id: 'guild' } });
    await prisma.users.create({ data: { discord_id: 'target' } });
    const detection = await prisma.detection_events.create({
      data: {
        server_id: 'guild',
        user_id: 'target',
        detection_type: 'user_report',
        confidence: 1,
        metadata: {},
      },
    });
    const input: ModerationActionRequestCreate = {
      serverId: 'guild',
      actorId: 'moderator',
      actorSurface: 'web',
      targetUserId: 'target',
      detectionEventId: detection.id,
      actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      idempotencyKey: 'enqueue-contract',
      metadata: { reason: 'Reviewed' },
    };
    const enqueue = (value = input) =>
      client === 'prisma'
        ? repository.enqueue(value)
        : insertModerationActionRequestWithReceipt(pool, {
            ...value,
            metadata: value.metadata as import('@drasil/application').EnqueueInput['metadata'],
          });
    const receipt = await enqueue();
    const read = () => repository.findById(receipt.id);
    return { prisma, repository, detection, input, enqueue, receipt, read };
  }
  it('same_key_same_binding_is_idempotent', async () => {
    const f = await fixture();
    const before = await f.read();
    const concurrentReceipts = await Promise.all([f.enqueue(), f.enqueue(), f.enqueue()]);
    expect(new Set(concurrentReceipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(getReportBanAttemptToken((await f.read())!)).toBe(getReportBanAttemptToken(before!));
  });
  it('completed_noop_retry_requires_eligible_unowned_subject', async () => {
    const f = await fixture();
    const token = getReportBanAttemptToken((await f.read())!);
    await f.repository.complete(
      f.receipt.id,
      { observed_ban_result: { status: 'already_handled' } },
      token
    );
    await f.prisma.detection_events.update({
      where: { id: f.detection.id },
      data: { metadata: { report_ban_operation_id: 'other' } },
    });
    const before = await f.read();
    expect((await f.enqueue()).status).toBe('completed');
    expect(await f.read()).toEqual(before);
    await f.prisma.detection_events.update({
      where: { id: f.detection.id },
      data: { metadata: {} },
    });
    expect((await f.enqueue()).status).toBe('queued');
    expect(getReportBanAttemptToken((await f.read())!)).not.toBe(token);
  });
  it.each(['preparing', 'enforcement_started', 'discord_confirmed', 'reconciliation_required'])(
    'protected_receipts_never_reset: %s',
    async (phase) => {
      const f = await fixture();
      await f.prisma.moderation_action_requests.update({
        where: { id: f.receipt.id },
        data: {
          status: 'failed',
          metadata: { report_ban_phase: phase },
          result: { observed_ban_result: { status: 'banned_updates_pending' } },
        },
      });
      const confirmedRequestBeforeReplay = await f.read();
      await f.enqueue({ ...f.input, actorId: 'other', metadata: { reason: 'Replay' } });
      const confirmedRequestAfterReplay = await f.read();
      expect(confirmedRequestAfterReplay).toEqual(confirmedRequestBeforeReplay);
    }
  );
  it('concurrent_retry_mints_one_attempt_token', async () => {
    const f = await fixture();
    const staleToken = getReportBanAttemptToken((await f.read())!);
    await f.repository.complete(
      f.receipt.id,
      { observed_ban_result: { status: 'already_handled' } },
      staleToken
    );
    const concurrentReceipts = await Promise.all([f.enqueue(), f.enqueue(), f.enqueue()]);
    const concurrentAttemptTokens = await Promise.all(
      concurrentReceipts.map(async (receipt) =>
        getReportBanAttemptToken((await f.repository.findById(receipt.id))!)
      )
    );
    expect(new Set(concurrentReceipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(new Set(concurrentAttemptTokens).size).toBe(1);
    expect(concurrentAttemptTokens[0]).not.toBe(staleToken);
    await f.repository.complete(
      f.receipt.id,
      { observed_ban_result: { status: 'banned' } },
      staleToken
    );
    const staleAttemptCanComplete = (await f.read())?.status === 'completed';
    expect(staleAttemptCanComplete).toBe(false);
  });
  it('mismatched_immutable_bindings_cannot_reuse_key', async () => {
    const f = await fixture();
    const token = getReportBanAttemptToken((await f.read())!);
    await f.repository.complete(
      f.receipt.id,
      { observed_ban_result: { status: 'already_handled' } },
      token
    );
    const before = await f.read();
    await f.enqueue({ ...f.input, targetUserId: 'other' });
    expect(await f.read()).toEqual(before);
  });
  it('does not replace actor or source within an active attempt', async () => {
    const f = await fixture();
    await f.enqueue({ ...f.input, actorId: 'other', metadata: { reason: 'Replacement' } });
    expect((await f.read())?.actor_id).toBe('moderator');
    expect((await f.read())?.metadata).toMatchObject({ reason: 'Reviewed' });
    await f.enqueue({
      ...f.input,
      actorSurface: 'discord_interaction',
      metadata: { reason: 'Replacement' },
    });
    expect((await f.read())?.actor_surface).toBe('web');
    expect((await f.read())?.metadata).toMatchObject({ reason: 'Reviewed' });
  });
  it('preserves processing non-ban payloads for both clients', async () => {
    const f = await fixture();
    await f.prisma.moderation_action_requests.update({
      where: { id: f.receipt.id },
      data: { action_type: 'manual_flag_user', status: 'processing' },
    });
    const before = await f.read();
    await f.enqueue({
      ...f.input,
      actionType: ModerationActionRequestType.MANUAL_FLAG_USER,
      metadata: { reason: 'Replacement' },
    });
    const after = await f.read();
    expect(after).toEqual(before);
  });
  it.each(['queued', 'failed'] as const)(
    'rejects every immutable storage binding mismatch while %s',
    async (status) => {
      const f = await fixture();
      await f.prisma.moderation_action_requests.update({
        where: { id: f.receipt.id },
        data: { status },
      });
      const before = await f.read();
      const patches: Partial<ModerationActionRequestCreate>[] = [
        { serverId: 'foreign' },
        { targetUserId: 'other' },
        { actionType: ModerationActionRequestType.KICK_OBSERVED_DETECTION },
        { detectionEventId: '00000000-0000-0000-0000-000000000001' },
        { reportIntakeId: '00000000-0000-0000-0000-000000000001' },
        { verificationEventId: '00000000-0000-0000-0000-000000000001' },
        { messageDeletionJobId: '00000000-0000-0000-0000-000000000001' },
      ];
      for (const patch of patches) {
        await f.enqueue({ ...f.input, ...patch, metadata: { reason: 'Replacement' } });
        expect(await f.read()).toEqual(before);
      }
    }
  );
  it.each([
    'report_ban_enforcement_id',
    'report_ban_enforcement_operation_id',
    'report_ban_confirmed_at',
  ])('preserves failed enforcement marker %s without phase', async (marker) => {
    const f = await fixture();
    await f.prisma.moderation_action_requests.update({
      where: { id: f.receipt.id },
      data: { status: 'failed', metadata: { [marker]: 'confirmed' } },
    });
    const before = await f.read();
    await f.enqueue();
    expect(await f.read()).toEqual(before);
  });
  it.each(['queued', 'processing', 'completed'] as const)(
    'preserves %s CAPTCHA pass receipts exactly',
    async (status) => {
      const f = await fixture();
      const event = await f.prisma.verification_events.create({
        data: { server_id: 'guild', user_id: 'target' },
      });
      await f.prisma.moderation_action_requests.update({
        where: { id: f.receipt.id },
        data: { action_type: 'apply_captcha_pass', verification_event_id: event.id, status },
      });
      const before = await f.read();
      await f.enqueue({
        ...f.input,
        actionType: ModerationActionRequestType.APPLY_CAPTCHA_PASS,
        verificationEventId: event.id,
        metadata: { generation: 2 },
      });
      expect(await f.read()).toEqual(before);
    }
  );
  it('returns real receipt IDs under concurrent first submission', async () => {
    const f = await fixture();
    await f.prisma.moderation_action_requests.delete({ where: { id: f.receipt.id } });
    const concurrentReceipts = await Promise.all(Array.from({ length: 8 }, () => f.enqueue()));
    expect(new Set(concurrentReceipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(concurrentReceipts[0].id).not.toBe(f.input.idempotencyKey);
    const row = await f.repository.findById(concurrentReceipts[0].id);
    expect(row).not.toBeNull();
  });
  it('preserves completed report-ban rows whose receipt has no observed outcome', async () => {
    const f = await fixture();
    await f.prisma.moderation_action_requests.update({
      where: { id: f.receipt.id },
      data: { status: 'completed', result: {} },
    });
    const before = await f.read();
    await f.enqueue({ ...f.input, metadata: { reason: 'Replacement' } });
    expect(await f.read()).toEqual(before);
  });
  it.each([
    'eligible',
    'input-only',
    'wrong-operation',
    'wrong-disposition',
    'wrong-enforcement',
    'same-attempt',
    'active-phase',
    'confirmed',
  ])(
    'requires a bound persisted absence review before releasing historical enforcement IDs: %s',
    async (mode) => {
      const f = await fixture();
      const review = {
        operation_id: mode === 'wrong-operation' ? 'other' : f.receipt.id,
        disposition:
          mode === 'wrong-disposition' ? 'other' : 'no_current_ban_historical_outcome_uncertain',
        attempt_token: 'reviewed-attempt',
        result: {
          observed_ban_result: { status: 'ban_outcome_unknown', operationId: f.receipt.id },
        },
        operation_metadata: {
          report_ban_phase: 'reconciliation_required',
          report_ban_attempt_token: 'reviewed-attempt',
          report_ban_enforcement_id: mode === 'wrong-enforcement' ? 'other' : 'enforcement',
        },
      };
      await f.prisma.moderation_action_requests.update({
        where: { id: f.receipt.id },
        data: {
          status: 'failed',
          result: {
            observed_ban_result: {
              status: 'ban_reviewed_no_current_ban',
              operationId: f.receipt.id,
            },
          },
          metadata: {
            report_ban_phase: mode === 'active-phase' ? 'reconciliation_required' : null,
            report_ban_confirmed_at: mode === 'confirmed' ? '2026-10-20T00:00:00Z' : null,
            report_ban_enforcement_id: 'enforcement',
            report_ban_attempt_token: mode === 'same-attempt' ? 'reviewed-attempt' : 'after-review',
            observed_ban_reviews: mode === 'input-only' ? [] : [review],
          },
        },
      });
      const before = await f.read();
      await f.enqueue({
        ...f.input,
        actorId: 'new-moderator',
        actorSurface: 'discord',
        metadata: { observed_ban_reviews: [review], reason: 'Fresh decision' },
      });
      const after = (await f.read())!;
      if (mode !== 'eligible') expect(after).toEqual(before);
      else {
        expect(after).toMatchObject({
          status: 'queued',
          actor_id: 'new-moderator',
          actor_surface: 'discord',
          result: {},
          metadata: { observed_ban_reviews: [review], reason: 'Fresh decision' },
        });
        expect(getReportBanAttemptToken(after)).not.toBe('after-review');
        expect(after.metadata).not.toHaveProperty('report_ban_enforcement_id');
      }
    }
  );
  it('returns the protected receipt after waiting on a concurrent first insert', async () => {
    const f = await fixture();
    const event = await f.prisma.verification_events.create({
      data: { server_id: 'guild', user_id: 'target' },
    });
    await f.prisma.moderation_action_requests.delete({ where: { id: f.receipt.id } });
    const writer = await pool.connect();
    let pending: ReturnType<typeof f.enqueue> | undefined;
    try {
      await writer.query('begin');
      const inserted = await writer.query<{ id: string }>(
        `
        insert into moderation_action_requests (
          server_id, action_type, actor_id, actor_surface, target_user_id,
          detection_event_id, verification_event_id, idempotency_key, metadata
        ) values ($1, 'apply_captcha_pass', $2, $3, $4, $5, $6, $7, '{"generation":1}') returning id`,
        [
          'guild',
          'drasil:captcha',
          'captcha',
          'target',
          f.detection.id,
          event.id,
          f.input.idempotencyKey,
        ]
      );
      pending = f.enqueue({
        ...f.input,
        actionType: ModerationActionRequestType.APPLY_CAPTCHA_PASS,
        actorId: 'drasil:captcha',
        actorSurface: 'captcha',
        verificationEventId: event.id,
        metadata: { generation: 2 },
      });
      // Wait for the second INSERT to take its snapshot and block on the first writer.
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        const activity = await pool.query<{ waiting: boolean }>(`
          select exists(select 1 from pg_stat_activity where datname = current_database()
            and wait_event_type = 'Lock' and query like '%insert into moderation_action_requests%') as waiting`);
        waiting = activity.rows[0].waiting;
        if (!waiting) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await writer.query('commit');
      const receipt = await pending;
      expect(receipt).toMatchObject({ id: inserted.rows[0].id, status: 'queued' });
      expect((await f.repository.findById(receipt.id))?.metadata).toEqual({ generation: 1 });
    } finally {
      await writer.query('rollback');
      writer.release();
      await pending;
    }
  });
});
