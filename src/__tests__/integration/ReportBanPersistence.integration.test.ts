import { getPrismaClient } from '../testDb';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import {
  DetectionType,
  ReportIntakeStatus,
  ModerationActionRequestType,
} from '../../repositories/types';
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('report ban claims and reconciliation (Postgres)', () => {
  async function fixture() {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild');
    const users = new UserRepository(prisma);
    await users.getOrCreateUser('reporter');
    await users.getOrCreateUser('target');
    const reports = new ReportIntakeRepository(prisma);
    const detections = new DetectionEventsRepository(prisma);
    const requests = new ModerationActionRequestRepository(prisma);
    const report = await reports.create({
      serverId: 'guild',
      reporterId: 'reporter',
      confirmedTargetUserId: 'target',
      status: ReportIntakeStatus.SUBMITTED,
      metadata: { original: true },
    });
    const detection = await detections.create({
      server_id: 'guild',
      user_id: 'target',
      detection_type: DetectionType.USER_REPORT,
      confidence: 1,
      metadata: { reportIntakeId: report.id },
    });
    const request = await requests.enqueue({
      serverId: 'guild',
      targetUserId: 'target',
      actorId: 'moderator',
      actorSurface: 'web',
      actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      reportIntakeId: report.id,
      detectionEventId: detection.id,
      idempotencyKey: 'report-ban',
    });
    const claim = {
      reportId: report.id,
      serverId: 'guild',
      targetUserId: 'target',
      detectionEventId: detection.id,
      operationId: request.id,
    };
    return { prisma, reports, detections, requests, report, detection, request, claim };
  }
  it('allows one report claimant and rejects competing target/close writers, preserving evidence claims', async () => {
    const f = await fixture();
    const claims = await Promise.all([
      f.reports.claimBan(f.claim),
      f.reports.claimBan({ ...f.claim, operationId: 'other' }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const current = (await f.reports.findById(f.report.id))!;
    expect(
      await f.reports.updateIfCurrent(current, { status: ReportIntakeStatus.DISMISSED })
    ).toBeNull();
    expect(await f.reports.update(f.report.id, { confirmedTargetUserId: 'other' })).toBeNull();
    await f.detections.claimObservedAction(f.detection.id, {
      observed_action: 'ban',
      observed_action_by: 'moderator',
    });
    await f.detections.patchMetadata(f.detection.id, {
      moderation_evidence: { captured_at: '2026-10-15T00:00:00Z' },
    });
    expect((await f.detections.findById(f.detection.id))?.metadata).toMatchObject({
      observed_action: 'ban',
      reportIntakeId: f.report.id,
      moderation_evidence: { captured_at: '2026-10-15T00:00:00Z' },
    });
  });
  it('rejects closed, foreign, wrong-target, and unrelated-detection claims', async () => {
    const f = await fixture();
    expect(await f.reports.claimBan({ ...f.claim, serverId: 'foreign' })).toBeNull();
    expect(await f.reports.claimBan({ ...f.claim, targetUserId: 'reporter' })).toBeNull();
    const other = await f.detections.create({
      server_id: 'guild',
      user_id: 'target',
      detection_type: DetectionType.USER_REPORT,
      confidence: 1,
    });
    expect(await f.reports.claimBan({ ...f.claim, detectionEventId: other.id })).toBeNull();
    expect(
      await f.reports.updateIfCurrent(f.report, { status: ReportIntakeStatus.DISMISSED })
    ).not.toBeNull();
    expect(await f.reports.claimBan(f.claim)).toBeNull();
  });
  it('leases completed pending receipts once, respects retry time, and recovers an expired lease', async () => {
    const f = await fixture();
    const due = new Date('2026-10-15T12:00:00Z');
    await f.requests.mergeMetadata(f.request.id, {
      report_ban_phase: 'discord_confirmed',
      report_ban_retry_at: due.toISOString(),
      report_ban_lease_until: due.toISOString(),
    });
    await f.requests.complete(f.request.id, {
      observed_ban_result: { status: 'banned_updates_pending', operationId: f.request.id },
    });
    expect(await f.requests.claimReportBanReconciliation(new Date(due.getTime() - 1))).toBeNull();
    const claims = await Promise.all([
      f.requests.claimReportBanReconciliation(due),
      f.requests.claimReportBanReconciliation(due),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      await f.requests.claimReportBanReconciliation(new Date(due.getTime() + 899_999))
    ).toBeNull();
    expect(
      await f.requests.claimReportBanReconciliation(new Date(due.getTime() + 900_000))
    ).toMatchObject({ id: f.request.id });
    expect((await f.requests.findById(f.request.id))?.status).toBe('completed');
  });
  it('never gives uncertain queued enforcement back to the ordinary worker', async () => {
    const f = await fixture();
    // Seed an interrupted persisted operation; normal writes now reject skipping preparation.
    await f.prisma.moderation_action_requests.update({
      where: { id: f.request.id },
      data: {
        metadata: {
          report_ban_phase: 'enforcement_started',
          report_ban_lease_until: new Date(0).toISOString(),
        },
      },
    });
    expect(await f.requests.claimNext()).toBeNull();
    expect(await f.requests.claimReportBanReconciliation(new Date())).toMatchObject({
      id: f.request.id,
    });
  });
  it('releases only the detection claim owned by the durable operation', async () => {
    const f = await fixture();
    await f.detections.claimObservedAction(f.detection.id, {
      observed_action: 'ban',
      observed_action_by: 'moderator',
      report_ban_operation_id: f.request.id,
    });
    expect(
      await f.detections.releaseObservedAction(f.detection.id, 'ban', 'moderator', 'other')
    ).toBeNull();
    expect((await f.detections.findById(f.detection.id))?.metadata).toHaveProperty(
      'observed_action',
      'ban'
    );
    expect(
      await f.detections.releaseObservedAction(f.detection.id, 'ban', 'moderator', f.request.id)
    ).not.toBeNull();
    expect((await f.detections.findById(f.detection.id))?.metadata).not.toHaveProperty(
      'observed_action'
    );
  });
  it.each(['ban', 'open_case'])(
    'rejects the competing claim when %s claims first',
    async (first) => {
      const f = await fixture();
      const open = () =>
        f.detections.claimObservedAction(f.detection.id, {
          observed_action: 'open_case',
          observed_action_by: 'moderator',
        });
      if (first === 'ban') {
        expect(await f.reports.claimBan(f.claim)).not.toBeNull();
        expect(await open()).toBeNull();
      } else {
        expect(await open()).not.toBeNull();
        expect(await f.reports.claimBan(f.claim)).toBeNull();
      }
    }
  );
  it.each([true, false])(
    'serializes overlapping report-ban and case-open claims (ban starts first: %s)',
    async (banFirst) => {
      const f = await fixture();
      const claims = [
        () => f.reports.claimBan(f.claim),
        () =>
          f.detections.claimObservedAction(f.detection.id, {
            observed_action: 'open_case',
            observed_action_by: 'moderator',
          }),
      ];
      if (!banFirst) claims.reverse();
      expect((await Promise.all(claims.map((claim) => claim()))).filter(Boolean)).toHaveLength(1);
    }
  );
});
