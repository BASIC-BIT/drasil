import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), queueReport: vi.fn(), release: vi.fn() }));

vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
vi.mock('./setupDataAdapter', () => ({
  getPostgresPool: () => ({
    query: mocks.queueReport,
    connect: async () => ({ query: mocks.queue, release: mocks.release }),
  }),
}));
const context = {
  actor: { kind: 'user' as const, userId: 'admin' },
  guildId: 'guild',
  source: 'web',
  requestId: 'submission-1',
};
function encodedCall(mock: typeof mocks.queueReport, index = 0) {
  const values = mock.mock.calls.filter(([sql]) =>
    sql.startsWith('insert into moderation_action_requests')
  )[index][1];
  return {
    actionType: values[1],
    idempotencyKey: values[9],
    actorId: values[2],
    actorSurface: values[3],
    metadata: JSON.parse(values[10]),
  };
}

import {
  queueCompleteSetupVerificationRequestWithReceipt,
  queueReportInstructionsRepairRequest,
} from './setupArtifactActionQueue';

describe('report panel requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueReport.mockResolvedValue({ rows: [{ id: 'request', status: 'queued' }] });
  });

  it('keeps repair requests separate from explicit reposts', async () => {
    await queueReportInstructionsRepairRequest({
      context,
      channelId: 'channel',
    });
    expect(encodedCall(mocks.queueReport)).toEqual(
      expect.objectContaining({
        actionType: 'upsert_report_instructions',
        metadata: {
          channel_id: 'channel',
          requested_surface: 'web',
          setup_action: 'upsert_report_instructions',
        },
      })
    );
  });

  it('deduplicates repeat reposts of the panel the administrator saw', async () => {
    const input = {
      context,
      channelId: 'channel',
      repost: true,
      expectedMessageId: 'old-panel',
      expectedChannelId: 'original-channel',
    };
    await queueReportInstructionsRepairRequest(input);
    await queueReportInstructionsRepairRequest(input);
    expect(encodedCall(mocks.queueReport)).toEqual(encodedCall(mocks.queueReport, 1));
    expect(encodedCall(mocks.queueReport)).toEqual(
      expect.objectContaining({
        idempotencyKey: 'web:setup:repost_report_instructions:guild:channel:old-panel:submission-1',
        metadata: expect.objectContaining({
          repost: true,
          expected_message_id: 'old-panel',
          expected_channel_id: 'original-channel',
        }),
      })
    );
  });

  it('allows another deliberate submission after a cleanup-only request completes', async () => {
    const input = {
      context,
      channelId: 'channel',
      repost: true,
      expectedMessageId: 'replacement',
    };
    await queueReportInstructionsRepairRequest({
      ...input,
      context: { ...context, requestId: 'cleanup' },
    });
    await queueReportInstructionsRepairRequest({
      ...input,
      context: { ...context, requestId: 'repost-after-refresh' },
    });
    expect(encodedCall(mocks.queueReport).idempotencyKey).not.toBe(
      encodedCall(mocks.queueReport, 1).idempotencyKey
    );
  });
});

describe('queueCompleteSetupVerificationRequestWithReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('insert into') ? [{ id: 'request-1', status: 'queued' }] : [],
    }));
  });

  it('leaves protection mode absent for full-settings repair requests', async () => {
    await queueCompleteSetupVerificationRequestWithReceipt({
      context: { ...context, guildId: 'guild-1', actor: { kind: 'user', userId: 'admin-1' } },
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'case-role-1',
    });

    expect(encodedCall(mocks.queue)).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ detection_response_mode: expect.anything() }),
      })
    );
  });

  it('stores wizard selections and the stable submission id for resume', async () => {
    await queueCompleteSetupVerificationRequestWithReceipt({
      context: { ...context, guildId: 'guild-1', actor: { kind: 'user', userId: 'admin-1' } },
      adminChannelId: 'admin-channel-1',
      caseRoleId: null,
      caseRoleName: 'Review Role',
      detectionResponseMode: 'record_only',
      onboardingWizard: true,
      submissionId: 'submission-1',
      reportInstructionsChannelId: null,

      verificationChannelId: null,
    });

    expect(encodedCall(mocks.queue)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          admin_channel_id: 'admin-channel-1',
          case_role_id: null,
          case_role_name: 'Review Role',
          detection_response_mode: 'record_only',
          onboarding_wizard: true,
          report_instructions_channel_id: null,
          submission_id: 'submission-1',
          verification_channel_id: null,
        }),
      })
    );
  });

  it('clears a prior wizard protection selection when retrying with preserve', async () => {
    await queueCompleteSetupVerificationRequestWithReceipt({
      context: { ...context, guildId: 'guild-1', actor: { kind: 'user', userId: 'admin-1' } },
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'case-role-1',
      onboardingWizard: true,
      submissionId: 'submission-1',
    });

    expect(encodedCall(mocks.queue)).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ detection_response_mode: null }),
      })
    );
  });
});
