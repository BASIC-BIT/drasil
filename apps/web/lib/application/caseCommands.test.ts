import { describe, expect, it } from 'vitest';
import { encodeQueuedAction, type QueuedCommand } from '@drasil/application';
import type { QueueCaseActionInput, WebCaseAction } from '../activeCaseDataAdapter';
import { buildQueuedCaseCommand } from './caseCommands';

const base = { adminId: 'moderator', guildId: 'guild', caseId: 'case' };
const binding = { caseId: 'case', targetUserId: 'user' };
const destructive = { ...binding, reason: 'Reviewed evidence', detectionEventId: null };
const translations: ReadonlyArray<{
  action: WebCaseAction;
  input?: Partial<QueueCaseActionInput>;
  command: QueuedCommand;
}> = [
  { action: 'verify_user', command: { kind: 'verify_case_user', ...binding } },
  { action: 'kick_user', command: { kind: 'kick_case_user', ...destructive } },
  { action: 'ban_user', command: { kind: 'ban_case_user', ...destructive } },
  { action: 'ban_by_id', command: { kind: 'ban_case_user_by_id', ...destructive } },
  { action: 'close_no_action', command: { kind: 'close_case_no_action', ...binding } },
  {
    action: 'create_thread',
    command: {
      kind: 'repair_active_case',
      ...binding,
      intent: 'moderator_repair',
      mode: 'create_thread',
    },
  },
  {
    action: 'repair_thread',
    command: {
      kind: 'repair_active_case',
      ...binding,
      intent: 'moderator_repair',
      mode: 'repair_thread',
    },
  },
  { action: 'refresh_notification', command: { kind: 'refresh_case_notification', ...binding } },
  { action: 'reopen_case', command: { kind: 'reopen_case', ...binding } },
  { action: 'sync_existing_ban', command: { kind: 'sync_existing_ban', ...binding } },
  { action: 'challenge_user', command: { kind: 'request_captcha_challenge', ...binding } },
  {
    action: 'retry_captcha',
    input: {
      attemptId: 'attempt-1',
      expectedCaptchaChallengeId: 'challenge-1',
      expectedCaptchaGeneration: 2,
    },
    command: {
      kind: 'retry_captcha_challenge',
      ...binding,
      expectedChallengeId: 'challenge-1',
      expectedGeneration: 2,
    },
  },
  {
    action: 'bypass_captcha',
    input: {
      attemptId: 'attempt-2',
      expectedCaptchaChallengeId: 'challenge-1',
      expectedCaptchaGeneration: 2,
    },
    command: {
      kind: 'bypass_captcha_challenge',
      ...binding,
      expectedChallengeId: 'challenge-1',
      expectedGeneration: 2,
      reason: 'Reviewed evidence',
    },
  },
  {
    action: 'quarantine_compromised_account',
    input: { quarantinePhase: 'execute', previewRequestId: 'preview' },
    command: {
      kind: 'quarantine_compromised_account',
      ...binding,
      reason: 'Reviewed evidence',
      previewReference: { kind: 'persisted_preview', requestId: 'preview' },
    },
  },
];

describe('buildQueuedCaseCommand', () => {
  it.each(translations)(
    'translates $action with its shipped binding',
    ({ action, input, command }) => {
      expect(
        buildQueuedCaseCommand({ ...base, action, reason: 'Reviewed evidence', ...input }, 'user')
      ).toEqual({ kind: 'outcome', outcome: command });
    }
  );

  it('keeps quarantine preview separate from execution', () => {
    expect(
      buildQueuedCaseCommand(
        {
          ...base,
          action: 'quarantine_compromised_account',
          quarantinePhase: 'preview',
          attemptId: 'preview-attempt',
        },
        'user'
      )
    ).toEqual({ kind: 'outcome', outcome: { kind: 'preview_account_quarantine', ...binding } });
  });

  it.each([
    {
      action: 'retry_captcha',
      attemptId: 'attempt-1',
      key: 'web:case-action:retry_captcha:guild:case:attempt-1',
    },
    {
      action: 'bypass_captcha',
      attemptId: 'attempt-2',
      key: 'web:case-action:bypass_captcha:guild:case:attempt-2',
    },
  ] as const)(
    'retains the submitted $action attempt in canonical encoding',
    ({ action, attemptId, key }) => {
      const result = buildQueuedCaseCommand(
        {
          ...base,
          action,
          attemptId,
          expectedCaptchaChallengeId: 'challenge-1',
          expectedCaptchaGeneration: 2,
        },
        'user'
      );
      if (result.kind === 'denied') throw new Error('Expected a bound command');
      expect(
        encodeQueuedAction(
          {
            guildId: 'guild',
            source: 'web',
            requestId: attemptId,
            actor: { kind: 'user', userId: 'moderator' },
          },
          result.outcome
        ).idempotencyKey
      ).toBe(key);
    }
  );

  it.each<Partial<QueueCaseActionInput> & { action: WebCaseAction }>([
    { action: 'retry_captcha', expectedCaptchaGeneration: 2 },
    { action: 'bypass_captcha', expectedCaptchaChallengeId: 'challenge-1' },
    {
      action: 'retry_captcha',
      expectedCaptchaChallengeId: 'challenge-1',
      expectedCaptchaGeneration: 0,
    },
    { action: 'quarantine_compromised_account' },
    { action: 'quarantine_compromised_account', quarantinePhase: 'preview' },
    { action: 'quarantine_compromised_account', quarantinePhase: 'execute' },
  ])('denies missing command binding %#', (input) => {
    expect(buildQueuedCaseCommand({ ...base, ...input }, 'user')).toEqual({
      kind: 'denied',
      code: 'stale_state',
    });
  });
});
