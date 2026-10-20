import type { ActionResult, QueuedCommand } from '@drasil/application';
import type { QueueCaseActionInput } from '../activeCaseDataAdapter';

export function buildQueuedCaseCommand(
  input: QueueCaseActionInput,
  userId: string
): ActionResult<QueuedCommand> {
  const binding = { caseId: input.caseId, targetUserId: userId };
  const destructive = { ...binding, reason: input.reason ?? null, detectionEventId: null };
  switch (input.action) {
    case 'challenge_user':
      return { kind: 'outcome', outcome: { kind: 'request_captcha_challenge', ...binding } };
    case 'retry_captcha':
    case 'bypass_captcha': {
      if (
        !input.expectedCaptchaChallengeId ||
        !input.expectedCaptchaGeneration ||
        !Number.isInteger(input.expectedCaptchaGeneration) ||
        input.expectedCaptchaGeneration < 1
      )
        return { kind: 'denied', code: 'stale_state' };
      const expected = {
        expectedChallengeId: input.expectedCaptchaChallengeId,
        expectedGeneration: input.expectedCaptchaGeneration,
      };
      return {
        kind: 'outcome',
        outcome:
          input.action === 'retry_captcha'
            ? { kind: 'retry_captcha_challenge', ...binding, ...expected }
            : {
                kind: 'bypass_captcha_challenge',
                ...binding,
                ...expected,
                reason: input.reason ?? '',
              },
      };
    }
    case 'quarantine_compromised_account':
      if (input.quarantinePhase === 'preview' && input.attemptId)
        return { kind: 'outcome', outcome: { kind: 'preview_account_quarantine', ...binding } };
      if (input.quarantinePhase !== 'execute' || !input.previewRequestId)
        return { kind: 'denied', code: 'stale_state' };
      return {
        kind: 'outcome',
        outcome: {
          kind: 'quarantine_compromised_account',
          ...binding,
          reason: input.reason ?? '',
          previewReference: { kind: 'persisted_preview', requestId: input.previewRequestId },
        },
      };
    case 'verify_user':
      return { kind: 'outcome', outcome: { kind: 'verify_case_user', ...binding } };
    case 'close_no_action':
      return { kind: 'outcome', outcome: { kind: 'close_case_no_action', ...binding } };
    case 'kick_user':
      return { kind: 'outcome', outcome: { kind: 'kick_case_user', ...destructive } };
    case 'ban_user':
      return { kind: 'outcome', outcome: { kind: 'ban_case_user', ...destructive } };
    case 'ban_by_id':
      return { kind: 'outcome', outcome: { kind: 'ban_case_user_by_id', ...destructive } };
    case 'create_thread':
    case 'repair_thread':
      return {
        kind: 'outcome',
        outcome: {
          kind: 'repair_active_case',
          ...binding,
          intent: 'moderator_repair',
          mode: input.action,
        },
      };
    case 'refresh_notification':
      return { kind: 'outcome', outcome: { kind: 'refresh_case_notification', ...binding } };
    case 'reopen_case':
      return { kind: 'outcome', outcome: { kind: 'reopen_case', ...binding } };
    case 'sync_existing_ban':
      return { kind: 'outcome', outcome: { kind: 'sync_existing_ban', ...binding } };
    default: {
      const exhaustive: never = input.action;
      return exhaustive;
    }
  }
}
