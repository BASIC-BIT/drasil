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
    expect(settings.observedActionBanRequiresReason).toBe(false);
    expect(settings.moderatorBanActionEnabled).toBe(true);
  });

  it('defaults new configs to restrict with moderator ban actions', () => {
    const settings = getDetectionResponseSettings({});

    expect(settings.mode).toBe('restrict');
    expect(settings.messageMode).toBe('restrict');
    expect(settings.joinMode).toBe('restrict');
    expect(settings.moderatorBanActionEnabled).toBe(true);
  });

  it('maps legacy auto_restrict=false configs to notify_only', () => {
    const settings = getDetectionResponseSettings({ auto_restrict: false });

    expect(settings.mode).toBe('notify_only');
  });

  it('uses an explicit detection response mode when configured', () => {
    const settings = getDetectionResponseSettings({
      auto_restrict: true,
      detection_response_mode: 'open_case',
    });

    expect(settings.mode).toBe('open_case');
  });

  it('uses per-event response mode overrides when configured', () => {
    const settings = getDetectionResponseSettings({
      detection_response_mode: 'notify_only',
      message_detection_response_mode: 'restrict',
      join_detection_response_mode: 'open_case',
    });

    expect(settings.mode).toBe('notify_only');
    expect(settings.messageMode).toBe('restrict');
    expect(settings.joinMode).toBe('open_case');
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

  it('allows moderator automatic detection exemption to be disabled', () => {
    const settings = getDetectionResponseSettings({
      automatic_detection_exempt_moderators: false,
    });

    expect(settings.automaticDetectionExemptModerators).toBe(false);
  });

  it('allows observed notification ban reasons to be required', () => {
    const settings = getDetectionResponseSettings({
      observed_action_ban_requires_reason: true,
    });

    expect(settings.observedActionBanRequiresReason).toBe(true);
  });

  it('clamps numeric observe-only notification settings', () => {
    const settings = getDetectionResponseSettings({
      observed_detection_min_confidence_threshold: 150,
      observed_detection_notification_window_minutes: -1,
    });

    expect(settings.observedMinConfidenceThreshold).toBe(100);
    expect(settings.observedNotificationWindowMinutes).toBe(1);
  });

  it('validates detection response modes', () => {
    expect(isDetectionResponseMode('notify_only')).toBe(true);
    expect(isDetectionResponseMode('unknown')).toBe(false);
  });
});
