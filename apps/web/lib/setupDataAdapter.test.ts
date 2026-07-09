import { describe, expect, it, vi } from 'vitest';
import { buildSetupSettingsPatch } from './setupDataAdapter';

describe('createSetupDataAdapter', () => {
  it('defaults to the postgres adapter', async () => {
    vi.stubEnv('DRASIL_WEB_DATA_PROVIDER', '');
    const { createSetupDataAdapter } = await import('./setupDataAdapter');

    expect(createSetupDataAdapter().provider).toBe('postgres');
  });

  it('can select the convex adapter boundary', async () => {
    vi.stubEnv('DRASIL_WEB_DATA_PROVIDER', 'convex');
    const { createSetupDataAdapter } = await import('./setupDataAdapter');

    expect(createSetupDataAdapter().provider).toBe('convex');
  });

  it('maps setup policy updates into server settings keys', () => {
    expect(
      buildSetupSettingsPatch({
        guildId: 'guild-1',
        heuristicMessageThreshold: 8,
        heuristicMessageTimeframeSeconds: 30,
        heuristicSuspiciousKeywords: ['example watch term'],
        moderationQueueChannelId: 'queue-channel',
        observedDetectionMinConfidenceThreshold: 80,
        observedDetectionNotificationWindowMinutes: 120,
        automaticDetectionExemptModerators: false,
        adminCaseOpenRequiresReason: true,
        moderatorBanActionRequiresReason: true,
        moderatorKickActionRequiresReason: true,
        moderatorBanActionEnabled: false,
        moderatorKickActionEnabled: false,
        observedActionKickEnabled: true,
        messageDetectionAutoKickEnabled: true,
        joinDetectionAutoKickEnabled: true,
        reportIntakeAutoKickEnabled: true,
        autoKickMinConfidenceThreshold: 97,
        manualIntakeEnabled: true,
        manualIntakeRoleId: 'manual-role',
        manualIntakeGracePeriodSeconds: 45,
        caseRoleLockdownAllowedChannelIds: ['rules-channel'],
        caseRoleLockdownAllowedCategoryIds: ['public-category'],
        caseReviewRemindersEnabled: false,
        caseReviewReminderStaleHours: 12,
        caseReviewReminderRepeatHours: 36,
        caseReviewVeryStaleDays: 5,
        reportIntakeConfirmedResponseMode: 'open_case',
        reportAiAnalyzeText: false,
        reportAiAnalyzeImages: true,
        reportAiOpenCaseThreshold: 0.87,
        reportAiMaxImages: 6,
        reportAiMaxImageBytes: 12 * 1024 * 1024,
        roleGateEnabled: true,
        honeypotRoleId: 'honeypot-role',
        memberAccessRoleId: null,
        honeypotRoleResponseMode: 'notify_only',
        roleQuarantineMode: 'on',
        roleQuarantineExemptRoleIds: ['admin-role'],
        verificationAnalysisEnabled: true,
        verificationAnalysisMessageLimit: 4,
        verificationAnalysisMaxAction: 'restrict',
        verificationAnalysisRestrictThreshold: 0.9,
        verificationPromptTemplate: null,
        serverAbout: 'A test server.',
        verificationContext: 'Real members mention reports.',
        expectedTopics: ['reports', 'setup'],
        caseResponderRoleIds: ['admin-role'],
        caseResponderRoutingMode: 'ping_only',
        caseResponderThreadMemberCap: 10,
      })
    ).toEqual({
      case_review_reminders_enabled: false,
      case_review_reminder_stale_hours: 12,
      case_review_reminder_repeat_hours: 36,
      case_review_very_stale_days: 5,
      moderation_queue_channel_id: 'queue-channel',
      observed_detection_min_confidence_threshold: 80,
      observed_detection_notification_window_minutes: 120,
      automatic_detection_exempt_moderators: false,
      admin_case_open_requires_reason: true,
      moderator_ban_action_requires_reason: true,
      moderator_kick_action_requires_reason: true,
      moderator_ban_action_enabled: false,
      moderator_kick_action_enabled: false,
      observed_action_kick_enabled: true,
      message_detection_auto_kick_enabled: true,
      join_detection_auto_kick_enabled: true,
      report_intake_auto_kick_enabled: true,
      auto_kick_min_confidence_threshold: 97,
      manual_intake_enabled: true,
      manual_intake_role_id: 'manual-role',
      manual_intake_grace_period_seconds: 45,
      case_role_lockdown_allowed_channel_ids: ['rules-channel'],
      case_role_lockdown_allowed_category_ids: ['public-category'],
      report_intake_confirmed_response_mode: 'open_case',
      report_ai_analyze_text: false,
      report_ai_analyze_images: true,
      report_ai_open_case_threshold: 0.87,
      report_ai_max_images: 6,
      report_ai_max_image_bytes: 12 * 1024 * 1024,
      role_gate_enabled: true,
      honeypot_role_id: 'honeypot-role',
      member_access_role_id: null,
      honeypot_role_response_mode: 'notify_only',
      role_quarantine_mode: 'on',
      role_quarantine_exempt_role_ids: ['admin-role'],
      verification_ai_thread_analysis_enabled: true,
      verification_ai_thread_analysis_message_limit: 4,
      verification_ai_max_action: 'restrict',
      verification_ai_restrict_threshold: 0.9,
      verification_prompt_template: null,
      server_about: 'A test server.',
      verification_context: 'Real members mention reports.',
      expected_topics: ['reports', 'setup'],
      case_responder_role_ids: ['admin-role'],
      case_responder_routing_mode: 'ping_only',
      case_responder_thread_member_cap: 10,
    });
  });

  it('keeps heuristic column updates out of the JSON settings patch', () => {
    expect(
      buildSetupSettingsPatch({
        guildId: 'guild-1',
        heuristicMessageThreshold: 8,
        heuristicMessageTimeframeSeconds: 30,
        heuristicSuspiciousKeywords: ['example watch term'],
      })
    ).toEqual({});
  });
});
