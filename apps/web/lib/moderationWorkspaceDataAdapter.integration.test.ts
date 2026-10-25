import { createModerationActionRequestDataAdapter } from './moderationActionRequestDataAdapter';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ownedTestDatabase } from '../../../scripts/owned-test-database.js';
import { getPostgresPool } from './setupDataAdapter';
import { createModerationAttentionDataAdapter } from './moderationAttentionDataAdapter';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
import { PostgresModerationInboxDataAdapter } from './moderationInboxDataAdapter';

vi.stubEnv('DRASIL_WEB_DATABASE_URL', ownedTestDatabase());
vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'false');
const pool = getPostgresPool();
let guildId: string;
let otherGuildId: string;
let reporterId: string;
let targetId: string;
let caseId: string;
let caseDetectionId: string;
let observedDetectionId: string;
let reportId: string;
let intakeId: string;
let foreignIntakeId: string;
let requestId: string;
let reportQueueId: string;
let supportQueueId: string;
let breachQueueId: string;
let screeningQueueId: string;
let observedQueueId: string;
const eventTime = '2026-10-21T14:40:00.000Z';
const fullEvidenceText = 'First line of submitted evidence.\nSecond line remains complete.';
const adapter = () =>
  createModerationWorkspaceDataAdapter({
    guildId,
    userId: reporterId,
    present: true,
    owner: true,
    permissions: '8',
    roleIds: [],
  });

beforeEach(async () => {
  guildId = `workspace-sql-${randomUUID()}`;
  otherGuildId = `workspace-sql-foreign-${randomUUID()}`;
  reporterId = `workspace-reporter-${randomUUID()}`;
  targetId = `workspace-target-${randomUUID()}`;
  [
    caseId,
    caseDetectionId,
    observedDetectionId,
    reportId,
    intakeId,
    foreignIntakeId,
    requestId,
    reportQueueId,
    supportQueueId,
    breachQueueId,
    screeningQueueId,
    observedQueueId,
  ] = Array.from({ length: 12 }, () => randomUUID());
  await pool.query('insert into servers(guild_id) values($1),($2)', [guildId, otherGuildId]);
  await pool.query(
    "insert into users(discord_id,username) values($1,'Stored reporter'),($2,'Stored target')",
    [reporterId, targetId]
  );
  await pool.query(
    'insert into server_members(server_id,user_id,discord_member_pending,discord_member_pending_since,discord_member_pending_last_checked_at) values($1,$2,true,$3,$3)',
    [guildId, targetId, eventTime]
  );
  await pool.query(
    "insert into report_intakes(id,server_id,reporter_id,status,confirmed_target_user_id,thread_id) values($1,$2,$3,'submitted',$4,$5),($6,$2,$3,'collecting_evidence',null,$7),($8,$9,$3,'collecting_evidence',null,$10)",
    [
      reportId,
      guildId,
      reporterId,
      targetId,
      `submitted-${reportId}`,
      intakeId,
      `intake-${intakeId}`,
      foreignIntakeId,
      otherGuildId,
      `foreign-${foreignIntakeId}`,
    ]
  );
  await pool.query(
    "insert into report_intake_evidence(intake_id,kind,content) values($1,'reporter_text','Submitted case evidence'),($2,'reporter_text','Foreign evidence must stay separate')",
    [reportId, foreignIntakeId]
  );
  await pool.query(
    "insert into detection_events(id,server_id,user_id,detection_type,confidence,reasons,detected_at,metadata) values($1,$2,$3,'user_report',0.8,ARRAY['Case detection reason'],$4,jsonb_build_object('reportIntakeId',$5::text)),($6,$2,$3,'user_report',0.9,ARRAY['First complete reason','Second complete reason'],$4,'{}')",
    [caseDetectionId, guildId, targetId, eventTime, reportId, observedDetectionId]
  );
  await pool.query(
    "insert into verification_events(id,server_id,user_id,detection_event_id,thread_id,status) values($1,$2,$3,$4,$5,'pending')",
    [caseId, guildId, targetId, caseDetectionId, `recovery-${caseId}`]
  );
  await pool.query('update detection_events set latest_verification_event_id=$1 where id=$2', [
    caseId,
    caseDetectionId,
  ]);
  await pool.query(
    "insert into moderation_action_requests(id,server_id,actor_id,actor_surface,action_type,target_user_id,verification_event_id,detection_event_id,report_intake_id,idempotency_key,status,requested_at) values($1,$2,$3,'web','verify_case_user',$4,$5,$6,$7,$8,'completed','2020-01-01T00:00:00Z')",
    [requestId, guildId, reporterId, targetId, caseId, caseDetectionId, reportId, randomUUID()]
  );
  await pool.query(
    "insert into moderation_queue_items(id,server_id,user_id,item_type,report_intake_id,source_thread_id,last_source_message_id) values($1,$2,$3,'report_thread_attention',$4,$5,'selected-reply')",
    [reportQueueId, guildId, reporterId, intakeId, `intake-${intakeId}`]
  );
  await pool.query(
    "insert into moderation_queue_items(id,server_id,user_id,item_type,verification_event_id,source_thread_id,last_source_message_id) values($1,$2,$3,'support_thread_attention',$4,$5,'support-reply'),($6,$2,$3,'quarantine_breach_attention',$4,'prohibited-channel','breach-reply')",
    [supportQueueId, guildId, targetId, caseId, `recovery-${caseId}`, breachQueueId]
  );
  await pool.query(
    "insert into moderation_queue_items(id,server_id,user_id,item_type,metadata) values($1,$2,$3,'pending_screening_member','{\"threshold_days\":7}')",
    [screeningQueueId, guildId, targetId]
  );
  await pool.query(
    "insert into moderation_queue_items(id,server_id,user_id,item_type,detection_event_id) values($1,$2,$3,'observed_alert_mirror',$4)",
    [observedQueueId, guildId, targetId, observedDetectionId]
  );
});
afterEach(async () => {
  await pool.query(
    'update detection_events set latest_verification_event_id=null where server_id=any($1::text[])',
    [[guildId, otherGuildId]]
  );
  await pool.query('delete from servers where guild_id=any($1::text[])', [[guildId, otherGuildId]]);
  await pool.query('delete from users where discord_id=any($1::text[])', [[reporterId, targetId]]);
});
afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});

it.each([false, true])(
  'executes early-intake evidence reads with evidence=%s',
  async (withEvidence) => {
    if (withEvidence)
      await pool.query(
        "insert into report_intake_evidence(intake_id,kind,content,attachment_id,metadata,created_at) values($1,'screenshot',$2,'attachment-1',$3,null)",
        [
          intakeId,
          fullEvidenceText,
          {
            name: 'submitted.png',
            url: 'https://example.com/submitted.png',
            contentType: 'image/png',
            size: 20,
          },
        ]
      );
    const detail = await createModerationAttentionDataAdapter().getAttentionDetail({
      guildId,
      queueItemId: reportQueueId,
    });
    expect(detail?.intake).toMatchObject({
      id: intakeId,
      status: 'collecting_evidence',
      targetUserId: null,
    });
    expect(detail?.intake?.evidence).toHaveLength(withEvidence ? 1 : 0);
    if (withEvidence)
      expect(detail?.intake?.evidence[0]).toMatchObject({
        content: fullEvidenceText,
        createdAt: null,
        attachment: { name: 'submitted.png', url: 'https://example.com/submitted.png' },
      });
    const selected = await adapter().getInboxItemDetail({
      guildId,
      itemId: `queue:${reportQueueId}`,
    });
    expect(selected).toMatchObject({
      kind: 'report_attention',
      intake: { status: 'collecting_evidence' },
      item: { allowedActions: ['acknowledge', 'open_discord'] },
      reply: {
        kind: 'unavailable',
        sourceUrl: `https://discord.com/channels/${guildId}/intake-${intakeId}/selected-reply`,
      },
    });
  }
);
it('executes the real inbox and all six selected-read branches with stored linkage', async () => {
  const inbox = await new PostgresModerationInboxDataAdapter().listInboxItems(guildId);
  expect(new Set(inbox.map((item) => item.kind))).toEqual(
    new Set([
      'case',
      'submitted_report',
      'observed_alert',
      'report_attention',
      'support_attention',
      'pending_screening',
    ])
  );
  const selected = await Promise.all(
    inbox.map((item) => adapter().getInboxItemDetail({ guildId, itemId: item.id }))
  );
  expect(selected.every((item) => item !== null)).toBe(true);
  expect(selected.find((item) => item?.kind === 'case')).toMatchObject({
    data: {
      detail: { id: caseId, status: 'pending' },
      report: { id: reportId },
      requests: [{ id: requestId, actorUserId: reporterId }],
      cleanup: { workspace: { verificationEventId: caseId, targetUserId: targetId }, jobs: [] },
    },
  });
  expect(selected.find((item) => item?.kind === 'submitted_report')).toMatchObject({
    report: { id: reportId, targetUserId: targetId },
    requests: [{ id: requestId, actorUserId: reporterId }],
  });
  expect(selected.find((item) => item?.kind === 'observed_alert')).toMatchObject({
    detection: {
      id: observedDetectionId,
      detectedAt: eventTime,
      reasons: ['First complete reason', 'Second complete reason'],
    },
  });
  expect(selected.find((item) => item?.kind === 'pending_screening')).toMatchObject({
    screening: { pendingSince: eventTime, thresholdDays: 7, lastCheckedAt: eventTime },
  });
});
it('keeps durable records readable after their pending queue state ends', async () => {
  await pool.query("update verification_events set status='verified' where id=$1", [caseId]);
  await pool.query("update report_intakes set status='actioned' where id=$1", [reportId]);
  await pool.query(
    'update detection_events set metadata=\'{"observed_action":"ban"}\' where id=$1',
    [observedDetectionId]
  );
  await pool.query('delete from moderation_queue_items where server_id=$1', [guildId]);
  const [caseItem, reportItem, detectionItem] = await Promise.all(
    [`case:${caseId}`, `report:${reportId}`, `detection:${observedDetectionId}`].map((itemId) =>
      adapter().getInboxItemDetail({ guildId, itemId })
    )
  );
  expect(caseItem).toMatchObject({
    kind: 'case',
    data: {
      detail: { status: 'verified' },
      requests: [{ id: requestId, actorUserId: reporterId }],
    },
  });
  expect(reportItem).toMatchObject({
    kind: 'submitted_report',
    report: { status: 'actioned' },
    requests: [{ id: requestId, actorUserId: reporterId }],
  });
  expect(detectionItem).toMatchObject({
    kind: 'observed_alert',
    item: { statusLabel: 'ban', allowedActions: ['view_history', 'open_discord'] },
  });
});
it('executes recovery and breach reads with their actual posting destinations', async () => {
  await pool.query("update verification_events set case_kind='compromised_account' where id=$1", [
    caseId,
  ]);
  const recovery = await adapter().getInboxItemDetail({
    guildId,
    itemId: `queue:${supportQueueId}`,
  });
  expect(recovery).toMatchObject({
    kind: 'support_attention',
    subtype: 'recovery_reply',
    caseData: { detail: { id: caseId } },
    reply: {
      sourceUrl: `https://discord.com/channels/${guildId}/recovery-${caseId}/support-reply`,
    },
  });
  const breach = await adapter().getInboxItemDetail({ guildId, itemId: `queue:${breachQueueId}` });
  expect(breach).toMatchObject({
    kind: 'support_attention',
    subtype: 'quarantine_breach',
    caseData: { detail: { id: caseId } },
    reply: { sourceUrl: `https://discord.com/channels/${guildId}/prohibited-channel/breach-reply` },
  });
});
it('rejects foreign source IDs and removes acknowledged attention from selected reads', async () => {
  await pool.query('update moderation_queue_items set report_intake_id=$1 where id=$2', [
    foreignIntakeId,
    reportQueueId,
  ]);
  expect(
    await adapter().getInboxItemDetail({ guildId, itemId: `queue:${reportQueueId}` })
  ).toBeNull();
  expect(
    await adapter().getInboxItemDetail({ guildId, itemId: `report:${foreignIntakeId}` })
  ).toBeNull();
  const foreignQueueId = randomUUID();
  await pool.query(
    "insert into moderation_queue_items(id,server_id,user_id,item_type,report_intake_id,source_thread_id) values($1,$2,$3,'report_thread_attention',$4,$5)",
    [foreignQueueId, otherGuildId, reporterId, foreignIntakeId, `foreign-${foreignIntakeId}`]
  );
  expect(
    await adapter().getInboxItemDetail({ guildId, itemId: `queue:${foreignQueueId}` })
  ).toBeNull();
  await pool.query('delete from moderation_queue_items where id=$1', [supportQueueId]);
  expect(
    await adapter().getInboxItemDetail({ guildId, itemId: `queue:${supportQueueId}` })
  ).toBeNull();
});

it('reads actual persisted quarantine ownership and recovery attention from the owned database', async () => {
  await pool.query(
    "update verification_events set case_kind='compromised_account',attention_state='parked',containment_status='contained',parked_by=$2,parked_at=now() where id=$1",
    [caseId, reporterId]
  );
  await pool.query(
    "update moderation_action_requests set action_type='preview_account_quarantine',completed_at=now(),result=$2::jsonb where id=$1",
    [
      requestId,
      JSON.stringify({
        action_type: 'preview_account_quarantine',
        enabled: true,
        previewed_at: new Date().toISOString(),
        containment_fingerprint: 'private-fingerprint',
      }),
    ]
  );
  const result = await adapter().getCaseWorkspaceData({ guildId, caseId });
  expect(result?.actorUserId).toBe(reporterId);
  expect(result?.requests).toMatchObject([
    { id: requestId, actorUserId: reporterId, accountQuarantinePreview: { enabled: true } },
  ]);
  expect(result?.detail.allowedActions).not.toContain('close_no_action');
  expect(result?.policy.allowedActions).not.toContain('close_no_action');
  expect(result?.recoveryAttention).toHaveLength(2);
  expect(
    result?.recoveryAttention?.find((item) => item.id === `queue:${breachQueueId}`)
  ).toMatchObject({
    subject: { userId: targetId },
    sourceMetadata: {
      subtype: 'quarantine_breach',
      caseId,
      sourceThreadId: 'prohibited-channel',
      latestReplyMessageId: 'breach-reply',
    },
  });
  expect(JSON.stringify(result)).not.toContain('private-fingerprint');
  const requests = await createModerationActionRequestDataAdapter().listCaseRequests(
    guildId,
    caseId
  );
  expect(requests[0]?.actorUserId).toBe(reporterId);
});

it('reads actual configured issuance and durable security intent bindings from Postgres', async () => {
  await pool.query('update servers set settings=$2::jsonb where guild_id=$1', [
    guildId,
    JSON.stringify({
      captcha_method: 'discord_image',
      captcha_method_revision: 8,
      captcha_mode: 'manual',
    }),
  ]);
  const binding = {
    expected_challenge_id: '11111111-1111-4111-8111-111111111111',
    expected_generation: 2,
    expected_configuration: { method: 'turnstile', methodRevision: 7 },
  };
  await pool.query(
    "update moderation_action_requests set action_type='retry_captcha_challenge',metadata=$2::jsonb where id=$1",
    [requestId, JSON.stringify(binding)]
  );
  const data = await adapter().getCaseWorkspaceData({ guildId, caseId });
  expect(data?.securityCheckConfiguration).toEqual({ method: 'discord_image', methodRevision: 8 });
  expect(data?.requests).toContainEqual(
    expect.objectContaining({
      id: requestId,
      captchaBinding: { challengeId: binding.expected_challenge_id, generation: 2 },
      captchaConfiguration: { method: 'turnstile', methodRevision: 7 },
    })
  );
  const byId = await createModerationActionRequestDataAdapter().getRequest(guildId, requestId);
  expect(byId?.captchaConfiguration).toEqual({ method: 'turnstile', methodRevision: 7 });
});
