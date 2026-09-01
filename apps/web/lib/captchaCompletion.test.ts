import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getPostgresPool: vi.fn(),
  insertModerationActionRequestWithReceipt: vi.fn(),
}));

vi.mock('./setupDataAdapter', () => ({ getPostgresPool: mocked.getPostgresPool }));
vi.mock('./moderationActionRequestQueue', () => ({
  insertModerationActionRequestWithReceipt: mocked.insertModerationActionRequestWithReceipt,
}));

import { completeCaptchaAttempt } from './captchaCompletion';

const challengeRow = {
  attempt_id: '00000000-0000-4000-8000-000000000001',
  attempt_generation: 1,
  case_revision_at_issue: 2,
  case_status: 'pending',
  expires_at: new Date(Date.now() + 60_000),
  generation: 1,
  id: '00000000-0000-4000-8000-000000000002',
  server_id: 'guild-1',
  server_settings: {
    captcha_max_submissions: 5,
    captcha_mode: 'manual',
  },
  status: 'pending',
  submission_count: 4,
  user_id: 'user-1',
  validation_state: 'started',
  verification_event_id: '00000000-0000-4000-8000-000000000003',
};

function createDatabaseHarness() {
  const query = vi.fn(async (statement: string, _parameters?: readonly unknown[]) => {
    if (statement.includes('from captcha_challenge_attempts a')) {
      return { rows: [challengeRow] };
    }
    if (statement.includes("set status = 'passed'")) {
      return { rows: [{ id: challengeRow.id }] };
    }
    return { rows: [] };
  });
  const client = {
    query,
    release: vi.fn(),
  };
  mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => client) });
  mocked.insertModerationActionRequestWithReceipt.mockResolvedValue({
    id: 'request-1',
    status: 'queued',
  });
  return { client, query };
}

describe('captcha completion transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks the generation failed and queues moderator attention at the submission limit', async () => {
    const { query } = createDatabaseHarness();

    await expect(
      completeCaptchaAttempt({
        attemptId: challengeRow.attempt_id,
        validation: {
          action: null,
          errorCodes: ['invalid-input-response'],
          hostname: null,
          state: 'invalid',
          success: false,
        },
      })
    ).resolves.toBe('failed');

    const challengeUpdate = query.mock.calls.find(([statement]) =>
      statement.includes('update captcha_challenges')
    );
    expect(challengeUpdate?.[1]).toEqual([challengeRow.id, 5, true, 1]);
    expect(mocked.insertModerationActionRequestWithReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: 'notify_captcha_attention',
        idempotencyKey: `captcha:attention:${challengeRow.id}:1:submission-limit`,
        verificationEventId: challengeRow.verification_event_id,
      })
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('records a provider error without consuming or failing the generation', async () => {
    const { query } = createDatabaseHarness();

    await expect(
      completeCaptchaAttempt({
        attemptId: challengeRow.attempt_id,
        validation: {
          action: null,
          errorCodes: ['internal-error'],
          hostname: null,
          state: 'provider_error',
          success: null,
        },
      })
    ).resolves.toBe('provider_error');

    const attemptUpdate = query.mock.calls.find(([statement]) =>
      statement.includes('update captcha_challenge_attempts')
    );
    expect(attemptUpdate?.[1]?.[2]).toBe(false);
    expect(
      query.mock.calls.some(([statement]) => statement.includes('update captcha_challenges'))
    ).toBe(false);
    expect(mocked.insertModerationActionRequestWithReceipt).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('marks a pass and queues its exact-case effect before commit', async () => {
    const { query } = createDatabaseHarness();

    await expect(
      completeCaptchaAttempt({
        attemptId: challengeRow.attempt_id,
        validation: {
          action: 'drasil_case_access',
          errorCodes: [],
          hostname: 'drasil.example',
          state: 'passed',
          success: true,
        },
      })
    ).resolves.toBe('passed');

    expect(mocked.insertModerationActionRequestWithReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: 'apply_captcha_pass',
        idempotencyKey: `captcha:apply:${challengeRow.id}:1`,
        metadata: {
          challenge_id: challengeRow.id,
          expected_case_revision: challengeRow.case_revision_at_issue,
          generation: 1,
        },
        targetUserId: challengeRow.user_id,
        verificationEventId: challengeRow.verification_event_id,
      })
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });
});
