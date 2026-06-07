import type { TextChannel } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import type { IServerRepository } from '../../repositories/ServerRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { Server, VerificationEvent, VerificationStatus } from '../../repositories/types';
import { CaseReviewReminderService } from '../../services/CaseReviewReminderService';

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
  metadata: VerificationEvent['metadata'] = null
): VerificationEvent => ({
  id: 'ver-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: 'det-1',
  thread_id: 'case-thread-1',
  private_evidence_thread_id: 'evidence-thread-1',
  notification_message_id: 'message-1',
  status: VerificationStatus.PENDING,
  created_at: updatedAt,
  updated_at: updatedAt,
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata,
});

describe('CaseReviewReminderService (unit)', () => {
  it('sends a rollup and stamps stale pending cases', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const staleCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'));
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
      findPendingByServer: jest.fn().mockResolvedValue([staleCase]),
      update: jest.fn().mockResolvedValue(staleCase),
    } as unknown as jest.Mocked<IVerificationEventRepository>;
    const configService = {
      getAdminChannel: jest.fn().mockResolvedValue({ send } as unknown as TextChannel),
    } as unknown as jest.Mocked<IConfigService>;

    const service = new CaseReviewReminderService(
      serverRepository,
      verificationEventRepository,
      configService
    );

    await service.runOnce(now);

    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining('There is 1 stale pending case needing review.'),
      allowedMentions: {
        parse: [],
        users: [],
        roles: ['123456789012345678'],
        repliedUser: false,
      },
    });
    expect(send.mock.calls[0][0].content).toContain('<@&123456789012345678>');
    expect(send.mock.calls[0][0].content).toContain('evidence-thread-1');
    expect(verificationEventRepository.update).toHaveBeenCalledWith(
      staleCase.id,
      expect.objectContaining({
        metadata: expect.objectContaining({
          case_review_last_reminded_at: now.toISOString(),
        }),
        updated_at: staleCase.updated_at,
      }),
      { touchUpdatedAt: false }
    );
  });

  it('suppresses repeat reminders until the repeat interval elapses', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const recentlyRemindedCase = buildPendingCase(new Date('2026-06-01T12:00:00.000Z'), {
      case_review_last_reminded_at: '2026-06-03T10:00:00.000Z',
    });
    const send = jest.fn().mockResolvedValue(undefined);
    const serverRepository = {
      findAllActive: jest.fn().mockResolvedValue([
        buildServer({
          case_review_reminders_enabled: true,
          case_review_reminder_stale_hours: 24,
          case_review_reminder_repeat_hours: 24,
        }),
      ]),
    } as unknown as jest.Mocked<IServerRepository>;
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([recentlyRemindedCase]),
      update: jest.fn(),
    } as unknown as jest.Mocked<IVerificationEventRepository>;
    const configService = {
      getAdminChannel: jest.fn().mockResolvedValue({ send } as unknown as TextChannel),
    } as unknown as jest.Mocked<IConfigService>;

    const service = new CaseReviewReminderService(
      serverRepository,
      verificationEventRepository,
      configService
    );

    await service.runOnce(now);

    expect(send).not.toHaveBeenCalled();
    expect(verificationEventRepository.update).not.toHaveBeenCalled();
  });
});
