import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialInboxActionState } from '@/lib/inboxActionState';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import { CaseActionControls } from './CaseActionControls';

function completedPreview(previewedAt: string): ModerationActionRequestSummary {
  return {
    accountQuarantinePreview: {
      adminNotificationReady: true,
      canContain: true,
      caseRole: { reason: null, roleId: 'case-role-1', roleName: 'Case Role' },
      caseRoleReady: true,
      enabled: true,
      lockdownErrorCount: 0,
      lockdownIssueCount: 0,
      lockdownPlannedActionCount: 0,
      memberBypassCount: 0,
      plannedRoles: [{ reason: null, roleId: 'member-role-1', roleName: 'Member' }],
      previewedAt,
      privilegedRoles: [],
      recoveryThreadId: 'thread-1',
      recoveryThreadReady: true,
      retainedRoles: [],
      unremovablePrivilegeReasons: [],
    },
    actionType: 'preview_account_quarantine',
    actorSurface: 'web',
    completedAt: previewedAt,
    detectionEventId: null,
    failedAt: null,
    id: 'preview-request-1',
    lastError: null,
    messageDeletionJobId: null,
    reportIntakeId: null,
    requestedAction: 'quarantine_compromised_account',
    requestedAt: previewedAt,
    resultSummary: 'Live preview: remove 1 role; retain 0; bypasses 0.',
    status: 'completed',
    targetUserId: 'user-1',
    updatedAt: previewedAt,
    verificationEventId: 'case-1',
  };
}

const queueCaseAction = async () => undefined;
const queueInboxCaseAction = async () => initialInboxActionState;

function renderControls(preview: ModerationActionRequestSummary): string {
  return renderToStaticMarkup(
    createElement(CaseActionControls, {
      accountQuarantineRequests: { execute: null, preview },
      actions: ['quarantine_compromised_account'],
      canQueueCaseActions: true,
      caseId: 'case-1',
      guildId: 'guild-1',
      queueCaseAction: queueCaseAction as never,
      queueInboxCaseAction: queueInboxCaseAction as never,
    })
  );
}

function renderVerificationControls(useInboxAction: boolean): string {
  return renderToStaticMarkup(
    createElement(CaseActionControls, {
      actions: ['verify_user'],
      canQueueCaseActions: true,
      caseId: 'case-1',
      guildId: 'guild-1',
      queueCaseAction: queueCaseAction as never,
      queueInboxCaseAction: useInboxAction ? (queueInboxCaseAction as never) : undefined,
      requiresVerificationReleaseConfirmation: true,
    })
  );
}

function renderCaptchaBypassControls(useInboxAction: boolean): string {
  return renderToStaticMarkup(
    createElement(CaseActionControls, {
      actions: ['bypass_captcha'],
      canQueueCaseActions: true,
      captchaChallenge: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        requestSource: 'moderator',
        passEffect: 'evidence_only',
        generation: 3,
        submissionCount: 5,
        expiresAt: '2026-09-01T12:00:00.000Z',
        requestedAt: '2026-09-01T11:00:00.000Z',
        deliveredAt: '2026-09-01T11:01:00.000Z',
        deliveryErrorCode: null,
        passedAt: null,
        bypassedAt: null,
        bypassedBy: null,
        bypassReason: null,
      },
      caseId: 'case-1',
      guildId: 'guild-1',
      queueCaseAction: queueCaseAction as never,
      queueInboxCaseAction: useInboxAction ? (queueInboxCaseAction as never) : undefined,
    })
  );
}

describe('CaseActionControls account quarantine', () => {
  it('allows a completed stale preview to be refreshed', () => {
    const markup = renderControls(completedPreview('2020-01-01T00:00:00.000Z'));

    expect(markup).toContain(
      '<button class="button secondary compact-button" type="submit">Preview account quarantine</button>'
    );
  });

  it('renders the reasoned confirmation only after a fresh completed preview', () => {
    const markup = renderControls(completedPreview(new Date(Date.now() + 60_000).toISOString()));

    expect(markup).toContain('Account quarantine live preview');
    expect(markup).toContain('Remove: Member');
    expect(markup).toContain('name="reason"');
    expect(markup).toContain('Confirm compromised-account quarantine');
    expect(markup).toContain('Queue account quarantine');
    expect(markup).toContain(
      'The user stays in the server, their verification thread remains open, and no Discord timeout is applied.'
    );
  });

  it.each([false, true])(
    'requires confirmation before releasing account quarantine (inbox action: %s)',
    (useInboxAction) => {
      const markup = renderVerificationControls(useInboxAction);

      expect(markup).toContain('Verify User');
      expect(markup).toContain('Confirm Verify User');
      expect(markup).toContain('name="confirmAction"');
      expect(markup).toContain('required=""');
      expect(markup).toContain(
        'This releases the account quarantine, restores eligible snapshotted roles, and resolves the open verification case.'
      );
    }
  );

  it.each([false, true])(
    'binds CAPTCHA bypass confirmation to the displayed challenge (inbox action: %s)',
    (useInboxAction) => {
      const markup = renderCaptchaBypassControls(useInboxAction);

      expect(markup).toContain(
        'type="hidden" name="expectedCaptchaChallengeId" value="11111111-1111-4111-8111-111111111111"'
      );
      expect(markup).toContain('type="hidden" name="expectedCaptchaGeneration" value="3"');
      expect(markup).not.toContain(
        '<button class="button secondary compact-button" type="submit">Continue Without Browser Check</button>'
      );
    }
  );
});
