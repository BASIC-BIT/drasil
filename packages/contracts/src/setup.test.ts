import { describe, expect, it } from 'vitest';
import {
  guildSetupUpdateSchema,
  MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH,
  MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES,
  setupDashboardSchema,
} from './setup';

describe('setup contracts', () => {
  it('accepts dashboard payloads with nullable server config', () => {
    const parsed = setupDashboardSchema.parse({
      guildId: '123',
      guildName: 'Test Guild',
      configured: false,
      dataProvider: 'postgres',
      checkedAt: new Date(0).toISOString(),
      checklist: [],
      server: null,
    });

    expect(parsed.configured).toBe(false);
  });

  it('rejects unsupported setup update modes', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      detectionResponseMode: 'ban_everyone',
    });

    expect(parsed.success).toBe(false);
  });

  it('normalizes legacy automatic open_case modes to notify_only', () => {
    const parsed = setupDashboardSchema.parse({
      guildId: '123',
      guildName: 'Test Guild',
      configured: true,
      dataProvider: 'postgres',
      checkedAt: new Date(0).toISOString(),
      checklist: [],
      server: {
        guild_id: '123',
        case_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        admin_notification_role_id: null,
        heuristic_message_threshold: 5,
        heuristic_message_timeframe_seconds: 60,
        heuristic_suspicious_keywords: [],
        created_at: null,
        updated_at: null,
        updated_by: null,
        settings: {
          detection_response_mode: 'open_case',
          message_detection_response_mode: 'open_case',
          join_detection_response_mode: 'open_case',
          user_report_external_response_mode: 'open_case',
        },
        is_active: true,
      },
    });

    expect(parsed.server?.settings).toMatchObject({
      detection_response_mode: 'notify_only',
      message_detection_response_mode: 'notify_only',
      join_detection_response_mode: 'notify_only',
      user_report_external_response_mode: 'open_case',
    });
  });

  it('normalizes legacy report AI restrict authority to open_case', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      reportAiMaxAction: 'restrict',
    });

    expect(parsed.reportAiMaxAction).toBe('open_case');
  });

  it('rejects custom message deletion watchlist terms over the bot matching limit', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      messageDeletionWatchlistCustomTerms: [
        'x'.repeat(MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH + 1),
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('does not ship default global watchlist entries in source code', () => {
    expect(MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES).toEqual([]);
  });
});
