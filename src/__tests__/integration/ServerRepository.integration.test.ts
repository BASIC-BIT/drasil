import { PrismaClient } from '../../db/prisma';
import { ServerRepository } from '../../repositories/ServerRepository';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('ServerRepository setup configuration (integration)', () => {
  let prisma: PrismaClient;
  let repository: ServerRepository;

  beforeEach(() => {
    prisma = getPrismaClient();
    repository = new ServerRepository(prisma);
  });

  it('atomically merges protection keys without replacing newer unrelated settings', async () => {
    await repository.upsertByGuildId('guild-setup-merge', {
      settings: {
        detection_response_mode: 'restrict',
        report_ai_triage_enabled: true,
      },
    });
    await repository.updateSettings('guild-setup-merge', {
      report_ai_triage_enabled: false,
      report_ai_max_action: 'hints',
    });
    await repository.setActive('guild-setup-merge', false);

    const updated = await repository.upsertSetupConfiguration('guild-setup-merge', {
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'case-role-1',
      verificationChannelId: 'verification-channel-1',
      settingsPatch: {
        detection_response_mode: 'notify_only',
        message_detection_response_mode: null,
        join_detection_response_mode: null,
      },
    });

    expect(updated).toMatchObject({
      admin_channel_id: 'admin-channel-1',
      case_role_id: 'case-role-1',
      verification_channel_id: 'verification-channel-1',
      is_active: true,
      settings: {
        detection_response_mode: 'notify_only',
        message_detection_response_mode: null,
        join_detection_response_mode: null,
        report_ai_triage_enabled: false,
        report_ai_max_action: 'hints',
      },
    });
  });

  it('preserves an inactive server during a settings-only upsert', async () => {
    await repository.upsertByGuildId('guild-inactive-settings', {
      is_active: false,
      settings: { setup_nudge_dismissed_at: '2026-08-25T12:00:00.000Z' },
    });

    const updated = await repository.upsertByGuildId('guild-inactive-settings', {
      settings: { setup_nudge_last_sent_at: '2026-08-25T13:00:00.000Z' },
    });

    expect(updated.is_active).toBe(false);
  });
});
