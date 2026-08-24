import { describe, expect, it } from 'vitest';
import { parseModerationActionRequestRow } from './moderationActionRequestDataAdapter';

describe('moderationActionRequestDataAdapter', () => {
  it('parses moderation action request rows for operations history', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-1',
        action_type: 'clear_moderation_queue',
        actor_surface: 'web',
        completed_at: new Date('2026-06-08T01:20:00.000Z'),
        failed_at: null,
        last_error: null,
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: { action_type: 'clear_moderation_queue', removed_count: 3 },
        status: 'completed',
        target_user_id: null,
        updated_at: new Date('2026-06-08T01:20:00.000Z'),
      })
    ).toEqual({
      id: 'request-1',
      actionType: 'clear_moderation_queue',
      actorSurface: 'web',
      completedAt: '2026-06-08T01:20:00.000Z',
      detectionEventId: null,
      failedAt: null,
      lastError: null,
      messageDeletionJobId: null,
      requestedAt: '2026-06-08T01:16:00.000Z',
      reportIntakeId: null,
      requestedAction: null,
      resultSummary: 'Removed 3 queue items.',
      status: 'completed',
      targetUserId: null,
      updatedAt: '2026-06-08T01:20:00.000Z',
      verificationEventId: null,
    });
  });

  it('summarizes resolved-thread dry-run results', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-2',
        action_type: 'close_resolved_case_threads',
        actor_surface: 'web',
        completed_at: new Date('2026-06-08T01:20:00.000Z'),
        failed_at: null,
        last_error: null,
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: {
          action_type: 'close_resolved_case_threads',
          already_closed_threads: 2,
          closed_threads: 0,
          execute: false,
          failed_threads: 1,
          missing_threads: 3,
          would_close_threads: 4,
        },
        status: 'completed',
        target_user_id: null,
        updated_at: new Date('2026-06-08T01:20:00.000Z'),
      }).resultSummary
    ).toBe('Dry run found 4 closable; already closed 2; missing 3; failed 1.');
  });

  it('parses the requested inbox action from request metadata', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-repair',
        action_type: 'repair_active_case',
        actor_surface: 'web',
        completed_at: null,
        failed_at: null,
        last_error: null,
        metadata: { case_action: 'create_thread' },
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: null,
        status: 'queued',
        target_user_id: 'user-1',
        updated_at: new Date('2026-06-08T01:16:00.000Z'),
      }).requestedAction
    ).toBe('create_thread');
  });

  it('summarizes lockdown apply results', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-3',
        action_type: 'apply_case_role_lockdown',
        actor_surface: 'web',
        completed_at: new Date('2026-06-08T01:20:00.000Z'),
        failed_at: null,
        last_error: null,
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: {
          action_type: 'apply_case_role_lockdown',
          applied_writes: 5,
          error_count: 0,
          planned_writes: 1,
          unsynced_allowed_channels: 2,
          warning_count: 3,
        },
        status: 'completed',
        target_user_id: null,
        updated_at: new Date('2026-06-08T01:20:00.000Z'),
      }).resultSummary
    ).toBe('Applied 5 writes; remaining 1; unsynced 2; errors 0; warnings 3.');
  });

  it('summarizes role intake dry-run results', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-4',
        action_type: 'intake_role_members',
        actor_surface: 'web',
        completed_at: new Date('2026-06-08T01:20:00.000Z'),
        failed_at: null,
        last_error: null,
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: {
          action_type: 'intake_role_members',
          eligible_members: 10,
          execute: false,
          failed: 0,
          opened: 0,
          processed: 8,
          role_name: 'Manual Intake',
          skipped_active_cases: 1,
        },
        status: 'completed',
        target_user_id: null,
        updated_at: new Date('2026-06-08T01:20:00.000Z'),
      }).resultSummary
    ).toBe('Dry run Manual Intake: selected 8 of 10; skipped active 1; failed 0.');
  });

  it('summarizes report instructions repair results', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-5',
        action_type: 'upsert_report_instructions',
        actor_surface: 'web',
        completed_at: new Date('2026-06-08T01:20:00.000Z'),
        failed_at: null,
        last_error: null,
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: {
          action: 'updated',
          action_type: 'upsert_report_instructions',
          channel_id: 'report-channel-1',
        },
        status: 'completed',
        target_user_id: null,
        updated_at: new Date('2026-06-08T01:20:00.000Z'),
      }).resultSummary
    ).toBe('Report instructions updated in report-channel-1.');
  });

  it('summarizes core setup completion results', () => {
    expect(
      parseModerationActionRequestRow({
        id: 'request-6',
        action_type: 'complete_setup_verification',
        actor_surface: 'web',
        completed_at: new Date('2026-06-08T01:20:00.000Z'),
        failed_at: null,
        last_error: null,
        requested_at: new Date('2026-06-08T01:16:00.000Z'),
        result: {
          action_type: 'complete_setup_verification',
          verification_channel_action: 'created',
        },
        status: 'completed',
        target_user_id: null,
        updated_at: new Date('2026-06-08T01:20:00.000Z'),
      }).resultSummary
    ).toBe('Core setup saved; verification channel created.');
  });

  it('parses resumable setup selections without exposing arbitrary metadata', () => {
    const request = parseModerationActionRequestRow({
      id: 'request-setup',
      action_type: 'complete_setup_verification',
      actor_surface: 'web',
      completed_at: null,
      failed_at: null,
      last_error: null,
      metadata: {
        admin_channel_id: 'admin-channel-1',
        case_role_id: null,
        case_role_name: 'Review Role',
        detection_response_mode: 'record_only',
        report_instructions_channel_id: null,
        submission_id: 'submission-1',
        verification_channel_id: null,
        unrelated_private_value: 'not exposed',
      },
      requested_at: new Date('2026-08-24T12:00:00.000Z'),
      result: null,
      status: 'queued',
      target_user_id: null,
      updated_at: new Date('2026-08-24T12:00:00.000Z'),
    });

    expect(request.setupInput).toEqual({
      adminChannelId: 'admin-channel-1',
      caseRoleId: null,
      caseRoleName: 'Review Role',
      detectionResponseMode: 'record_only',
      reportInstructionsChannelId: null,
      submissionId: 'submission-1',
      verificationChannelId: null,
    });
    expect(request).not.toHaveProperty('metadata');
  });

  it('parses cleanup job receipts and aggregate result summaries', () => {
    const request = parseModerationActionRequestRow({
      id: 'request-cleanup',
      action_type: 'execute_case_message_deletion',
      actor_surface: 'web_case',
      completed_at: new Date('2026-07-15T12:05:00.000Z'),
      failed_at: null,
      last_error: null,
      message_deletion_job_id: 'job-1',
      requested_at: new Date('2026-07-15T12:04:00.000Z'),
      result: {
        action_type: 'execute_case_message_deletion',
        changed_since_preview_count: 1,
        delete_failed_count: 0,
        deleted_count: 3,
        evidence_failed_count: 0,
        permission_denied_count: 1,
        preserved_count: 4,
      },
      status: 'completed',
      target_user_id: 'user-1',
      updated_at: new Date('2026-07-15T12:05:00.000Z'),
      verification_event_id: 'case-1',
    });

    expect(request.messageDeletionJobId).toBe('job-1');
    expect(request.resultSummary).toBe('Preserved 4; deleted 3; changed 1; failed 1.');
  });

  it('parses the live account-quarantine preview used for confirmation', () => {
    const request = parseModerationActionRequestRow({
      id: 'request-quarantine-preview',
      action_type: 'preview_account_quarantine',
      actor_surface: 'web',
      completed_at: new Date('2026-08-18T12:05:00.000Z'),
      failed_at: null,
      last_error: null,
      requested_at: new Date('2026-08-18T12:04:00.000Z'),
      result: {
        action_type: 'preview_account_quarantine',
        admin_notification_ready: true,
        can_contain: false,
        case_role_ready: true,
        enabled: true,
        lockdown_error_count: 1,
        lockdown_issues: [{ code: 'lockdown-gap' }],
        lockdown_planned_actions: 2,
        member_bypasses: [{ channel_id: 'channel-1' }],
        planned_roles: [{ role_id: 'role-1', role_name: 'Member' }],
        previewed_at: '2026-08-18T12:05:00.000Z',
        privileged_roles: [{ role_id: 'role-2', role_name: 'Moderator' }],
        recovery_thread_ready: true,
        retained_roles: [
          { role_id: 'role-managed', role_name: 'Managed', reason: 'managed by integration' },
        ],
        unremovable_privilege_reasons: ['guild_owner'],
      },
      status: 'completed',
      target_user_id: 'user-1',
      updated_at: new Date('2026-08-18T12:05:00.000Z'),
      verification_event_id: 'case-1',
    });

    expect(request.resultSummary).toBe('Live preview: remove 1 role; retain 1; bypasses 1.');
    expect(request.accountQuarantinePreview).toEqual(
      expect.objectContaining({
        adminNotificationReady: true,
        canContain: false,
        lockdownPlannedActionCount: 2,
        memberBypassCount: 1,
        plannedRoles: [{ roleId: 'role-1', roleName: 'Member', reason: null }],
        retainedRoles: [
          {
            roleId: 'role-managed',
            roleName: 'Managed',
            reason: 'managed by integration',
          },
        ],
      })
    );
  });
});
