import {
  getDetectionResponseSettings,
  isDetectionResponseMode,
} from '../../utils/detectionResponseSettings';

describe('detectionResponseSettings (unit)', () => {
  it('defaults to restrict mode for existing auto-restrict configs', () => {
    const settings = getDetectionResponseSettings({ auto_restrict: true });

    expect(settings.mode).toBe('restrict');
    expect(settings.messageMode).toBe('restrict');
    expect(settings.joinMode).toBe('restrict');
    expect(settings.observedMinConfidenceThreshold).toBe(70);
    expect(settings.observedNotificationWindowMinutes).toBe(60);
    expect(settings.automaticDetectionExemptModerators).toBe(true);
    expect(settings.adminCaseOpenRequiresReason).toBe(false);
    expect(settings.observedActionBanRequiresReason).toBe(false);
    expect(settings.moderatorBanActionRequiresReason).toBe(false);
    expect(settings.moderatorKickActionRequiresReason).toBe(false);
    expect(settings.moderatorBanActionEnabled).toBe(true);
    expect(settings.moderatorKickActionEnabled).toBe(true);
    expect(settings.observedActionKickEnabled).toBe(false);
    expect(settings.messageDetectionAutoKickEnabled).toBe(false);
    expect(settings.joinDetectionAutoKickEnabled).toBe(false);
    expect(settings.reportIntakeAutoKickEnabled).toBe(false);
    expect(settings.autoKickMinConfidenceThreshold).toBe(95);
  });

  it('defaults new configs to restrict with manual case actions enabled', () => {
    const settings = getDetectionResponseSettings({});

    expect(settings.mode).toBe('restrict');
    expect(settings.messageMode).toBe('restrict');
    expect(settings.joinMode).toBe('restrict');
    expect(settings.moderatorBanActionEnabled).toBe(true);
    expect(settings.moderatorKickActionEnabled).toBe(true);
    expect(settings.adminCaseOpenRequiresReason).toBe(false);
    expect(settings.moderatorBanActionRequiresReason).toBe(false);
    expect(settings.moderatorKickActionRequiresReason).toBe(false);
    expect(settings.observedActionKickEnabled).toBe(false);
    expect(settings.messageDetectionAutoKickEnabled).toBe(false);
    expect(settings.joinDetectionAutoKickEnabled).toBe(false);
    expect(settings.reportIntakeAutoKickEnabled).toBe(false);
  });

  it('maps legacy auto_restrict=false configs to notify_only', () => {
    const settings = getDetectionResponseSettings({ auto_restrict: false });

    expect(settings.mode).toBe('notify_only');
  });

  it('uses an explicit detection response mode when configured', () => {
    const settings = getDetectionResponseSettings({
      auto_restrict: true,
      detection_response_mode: 'notify_only',
    });

    expect(settings.mode).toBe('notify_only');
  });

  it('maps legacy open_case detection response settings to notify_only', () => {
    const settings = getDetectionResponseSettings({
      detection_response_mode: 'open_case',
      join_detection_response_mode: 'open_case',
    } as unknown as Parameters<typeof getDetectionResponseSettings>[0]);

    expect(settings.mode).toBe('notify_only');
    expect(settings.joinMode).toBe('notify_only');
  });

  it('uses per-event response mode overrides when configured', () => {
    const settings = getDetectionResponseSettings({
      detection_response_mode: 'notify_only',
      message_detection_response_mode: 'restrict',
      join_detection_response_mode: 'record_only',
    });

    expect(settings.mode).toBe('notify_only');
    expect(settings.messageMode).toBe('restrict');
    expect(settings.joinMode).toBe('record_only');
    expect(
      getDetectionResponseSettings(
        { detection_response_mode: 'notify_only', message_detection_response_mode: 'restrict' },
        'message'
      ).mode
    ).toBe('restrict');
  });

  it('allows moderator ban actions to be disabled', () => {
    const settings = getDetectionResponseSettings({
      moderator_ban_action_enabled: false,
    });

    expect(settings.moderatorBanActionEnabled).toBe(false);
  });

  it('allows moderator ban actions to be explicitly enabled', () => {
    const settings = getDetectionResponseSettings({
      moderator_ban_action_enabled: true,
    });

    expect(settings.moderatorBanActionEnabled).toBe(true);
  });

  it('allows kick policy gates to be explicitly enabled', () => {
    const settings = getDetectionResponseSettings({
      moderator_kick_action_enabled: true,
      observed_action_kick_enabled: true,
      message_detection_auto_kick_enabled: true,
      join_detection_auto_kick_enabled: true,
      report_intake_auto_kick_enabled: true,
    });

    expect(settings.moderatorKickActionEnabled).toBe(true);
    expect(settings.observedActionKickEnabled).toBe(true);
    expect(settings.messageDetectionAutoKickEnabled).toBe(true);
    expect(settings.joinDetectionAutoKickEnabled).toBe(true);
    expect(settings.reportIntakeAutoKickEnabled).toBe(true);
  });

  it('allows moderator kick actions to be explicitly disabled', () => {
    const settings = getDetectionResponseSettings({
      moderator_kick_action_enabled: false,
    });

    expect(settings.moderatorKickActionEnabled).toBe(false);
  });

  it('allows moderator automatic detection exemption to be disabled', () => {
    const settings = getDetectionResponseSettings({
      automatic_detection_exempt_moderators: false,
    });

    expect(settings.automaticDetectionExemptModerators).toBe(false);
  });

  it('allows staff action reasons to be required', () => {
    const settings = getDetectionResponseSettings({
      admin_case_open_requires_reason: true,
      moderator_ban_action_requires_reason: true,
      moderator_kick_action_requires_reason: true,
    });

    expect(settings.adminCaseOpenRequiresReason).toBe(true);
    expect(settings.observedActionBanRequiresReason).toBe(true);
    expect(settings.moderatorBanActionRequiresReason).toBe(true);
    expect(settings.moderatorKickActionRequiresReason).toBe(true);
  });

  it('maps legacy observed ban reason policy to the shared ban reason policy', () => {
    const settings = getDetectionResponseSettings({
      observed_action_ban_requires_reason: true,
    });

    expect(settings.observedActionBanRequiresReason).toBe(true);
    expect(settings.moderatorBanActionRequiresReason).toBe(true);
  });

  it('clamps numeric observe-only notification settings', () => {
    const settings = getDetectionResponseSettings({
      observed_detection_min_confidence_threshold: 150,
      observed_detection_notification_window_minutes: -1,
    });

    expect(settings.observedMinConfidenceThreshold).toBe(100);
    expect(settings.observedNotificationWindowMinutes).toBe(1);
  });

  it('clamps auto-kick confidence threshold to the strict range', () => {
    expect(
      getDetectionResponseSettings({ auto_kick_min_confidence_threshold: 150 })
        .autoKickMinConfidenceThreshold
    ).toBe(100);
    expect(
      getDetectionResponseSettings({ auto_kick_min_confidence_threshold: 50 })
        .autoKickMinConfidenceThreshold
    ).toBe(90);
  });

  it('validates detection response modes', () => {
    expect(isDetectionResponseMode('notify_only')).toBe(true);
    expect(isDetectionResponseMode('unknown')).toBe(false);
  });
});
