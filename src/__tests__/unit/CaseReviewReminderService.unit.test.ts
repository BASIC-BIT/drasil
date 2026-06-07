import type { TextChannel } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import type { IServerRepository } from '../../repositories/ServerRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { Server, VerificationEvent, VerificationStatus } from '../../repositories/types';
import { CaseReviewReminderService } from '../../services/CaseReviewReminderService';
import { CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY } from '../../utils/caseReviewReminderSettings';

const buildServer = (settings: Server['settings']): Server => ({
  guild_id: 'guild-1',
  restricted_role_id: null,
  admin_channel_id: 'admin-1',
  verification_channel_id: null,
  admin_notification_role_id: null,
  heuristic_message_threshold: 5,
  heuristic_message_timeframe_seconds: 60,
  heuristic_suspicious_keywords: [],
  created_at: null,
  updated_at: null,
  updated_by: null,
  settings,
  is_active: true,
});

const buildPendingCase = (
  updatedAt: Date,
  metadata: VerificationEvent['metadata'] = null,
  overrides: Partial<VerificationEvent> = {}
): VerificationEvent => ({
  id: overrides.id ?? 'ver-1',
  server_id: 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  detection_event_id: overrides.detection_event_id ?? 'det-1',
  thread_id: overrides.thread_id ?? 'case-thread-1',
  private_evidence_thread_id: overrides.private_evidence_thread_id ?? 'evidence-thread-1',
  notification_message_id: overrides.notification_message_id ?? 'message-1',
  status: VerificationStatus.PENDING,
  created_at: updatedAt,
  updated_at: updatedAt,
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata,
});

describe('CaseReviewReminderService (unit)', () => {
  it('sends one all-pending digest, stale cases first, with direct admin links', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const staleCase = buildPendingCase(
      new Date('2026-06-02T10:00:00.000Z'),
      {
        source_channel_id: 'source-channel-1',
        source_message_id: 'source-message-1',
      },
      { id: 'ver-stale', user_id: 'user-stale', notification_message_id: 'admin-message-1' }
    );
    const freshCase = buildPendingCase(new Date('2026-06-03T10:00:00.000Z'), null, {
      id: 'ver-fresh',
      user_id: 'user-fresh',
      notification_message_id: 'admin-message-2',
    });
    const send = jest.fn().mockResolvedValue(undefined);
    const serverRepository = {
      findAllActive: jest.fn().mockResolvedValue([
        buildServer({
          case_review_reminders_enabled: true,
          case_review_reminder_stale_hours: 24,
          case_review_reminder_repeat_hours: 24,
          case_responder_role_ids: ['123456789012345678'],
          case_responder_routing_mode: 'ping_only',
        }),
      ]),
    } as unknown as jest.Mocked<IServerRepository>;
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([freshCase, staleCase]),
      update: jest.fn(),
    } as unknown as jest.Mocked<IVerificationEventRepository>;
    const configService = {
      getAdminChannel: jest
        .fn()
        .mockResolvedValue({ id: 'admin-channel-actual', send } as unknown as TextChannel),
      updateServerSettings: jest.fn().mockResolvedValue({} as Server),
    } as unknown as jest.Mocked<IConfigService>;

    const service = new CaseReviewReminderService(
      serverRepository,
      verificationEventRepository,
      configService
    );

    await service.runOnce(now);

    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining('There are 2 pending cases needing review; 1 is stale.'),
      allowedMentions: {
        parse: [],
        users: [],
        roles: ['123456789012345678'],
        repliedUser: false,
      },
      components: expect.any(Array),
    });
    const content = send.mock.calls[0][0].content;
    expect(content).toContain('<@&123456789012345678>');
    expect(content.indexOf('[STALE] <@user-stale>')).toBeLessThan(
      content.indexOf('[pending] <@user-fresh>')
    );
    expect(content).toContain(
      'admin: https://discord.com/channels/guild-1/admin-channel-actual/admin-message-1'
    );
    expect(content).toContain('evidence-thread-1');
    expect(content).toContain(
      'source: https://discord.com/channels/guild-1/source-channel-1/source-message-1'
    );
    expect(send.mock.calls[0][0].components).toHaveLength(1);
    expect(configService.updateServerSettings).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({
        [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: now.toISOString(),
      })
    );
    expect(verificationEventRepository.update).not.toHaveBeenCalled();
  });

  it('suppresses newly stale cases until the server repeat interval elapses', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const newlyStaleCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'));
    const send = jest.fn().mockResolvedValue(undefined);
    const serverRepository = {
      findAllActive: jest.fn().mockResolvedValue([
        buildServer({
          case_review_reminders_enabled: true,
          case_review_reminder_stale_hours: 24,
          case_review_reminder_repeat_hours: 24,
          [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: '2026-06-03T10:00:00.000Z',
        }),
      ]),
    } as unknown as jest.Mocked<IServerRepository>;
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([newlyStaleCase]),
      update: jest.fn(),
    } as unknown as jest.Mocked<IVerificationEventRepository>;
    const configService = {
      getAdminChannel: jest.fn().mockResolvedValue({ send } as unknown as TextChannel),
      updateServerSettings: jest.fn(),
    } as unknown as jest.Mocked<IConfigService>;

    const service = new CaseReviewReminderService(
      serverRepository,
      verificationEventRepository,
      configService
    );

    await service.runOnce(now);

    expect(send).not.toHaveBeenCalled();
    expect(verificationEventRepository.update).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });
});
