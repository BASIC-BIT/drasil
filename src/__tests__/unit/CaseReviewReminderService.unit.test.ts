import type { Client, TextChannel, ThreadChannel } from 'discord.js';
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
  thread_id: 'thread_id' in overrides ? (overrides.thread_id ?? null) : 'case-thread-1',
  private_evidence_thread_id: overrides.private_evidence_thread_id ?? 'evidence-thread-1',
  notification_channel_id:
    'notification_channel_id' in overrides ? (overrides.notification_channel_id ?? null) : null,
  notification_message_id:
    'notification_message_id' in overrides
      ? (overrides.notification_message_id ?? null)
      : 'message-1',
  status: VerificationStatus.PENDING,
  created_at: overrides.created_at ?? updatedAt,
  updated_at: updatedAt,
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata,
});

const buildLargePendingCases = (count: number, updatedAt: Date): VerificationEvent[] =>
  Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const longId = `${suffix}12345678901234567890123456789012345678901234567890`;

    return buildPendingCase(
      updatedAt,
      {
        source_channel_id: `source-channel-${longId}`,
        source_message_id: `source-message-${longId}`,
      },
      {
        id: `ver-${suffix}`,
        user_id: longId,
        notification_message_id: `admin-message-${longId}`,
        private_evidence_thread_id: `evidence-thread-${longId}`,
        thread_id: `case-thread-${longId}`,
      }
    );
  });

function buildService(input: {
  server: Server;
  pendingCases: VerificationEvent[];
  adminSend?: jest.Mock;
  threadSend?: jest.Mock;
}): {
  service: CaseReviewReminderService;
  configService: jest.Mocked<IConfigService>;
  verificationEventRepository: jest.Mocked<IVerificationEventRepository>;
  client: Client;
} {
  const adminSend = input.adminSend ?? jest.fn().mockResolvedValue(undefined);
  const threadSend = input.threadSend ?? jest.fn().mockResolvedValue(undefined);
  const serverRepository = {
    findAllActive: jest.fn().mockResolvedValue([input.server]),
  } as unknown as jest.Mocked<IServerRepository>;
  const verificationEventRepository = {
    findPendingByServer: jest.fn().mockResolvedValue(input.pendingCases),
    update: jest.fn().mockResolvedValue({} as VerificationEvent),
  } as unknown as jest.Mocked<IVerificationEventRepository>;
  const configService = {
    getAdminChannel: jest
      .fn()
      .mockResolvedValue({ id: 'admin-channel-actual', send: adminSend } as unknown as TextChannel),
    updateServerSettings: jest.fn().mockResolvedValue({} as Server),
  } as unknown as jest.Mocked<IConfigService>;
  const client = {
    channels: {
      fetch: jest
        .fn()
        .mockResolvedValue({ isThread: () => true, send: threadSend } as unknown as ThreadChannel),
    },
  } as unknown as Client;

  return {
    service: new CaseReviewReminderService(
      serverRepository,
      verificationEventRepository,
      configService,
      client
    ),
    configService,
    verificationEventRepository,
    client,
  };
}

describe('CaseReviewReminderService (unit)', () => {
  const originalDrasilWebPublicUrl = process.env.DRASIL_WEB_PUBLIC_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.DRASIL_WEB_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (originalDrasilWebPublicUrl === undefined) {
      delete process.env.DRASIL_WEB_PUBLIC_URL;
    } else {
      process.env.DRASIL_WEB_PUBLIC_URL = originalDrasilWebPublicUrl;
    }

    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
  });

  it('sends a grouped all-pending digest with direct admin links and user reminder timing', async () => {
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
    const adminSend = jest.fn().mockResolvedValue(undefined);
    const { service, configService, verificationEventRepository, client } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
        case_responder_role_ids: ['123456789012345678'],
        case_responder_routing_mode: 'ping_only',
      }),
      pendingCases: [freshCase, staleCase],
      adminSend,
    });

    await service.runOnce(now);

    expect(adminSend).toHaveBeenCalledWith({
      content: expect.stringContaining(
        'There are 2 pending cases needing review: 1 fresh, 1 stale, 0 very stale.'
      ),
      allowedMentions: {
        parse: [],
        users: [],
        roles: ['123456789012345678'],
        repliedUser: false,
      },
      components: expect.any(Array),
    });
    const content = adminSend.mock.calls[0][0].content;
    expect(content).toContain('<@&123456789012345678>');
    expect(content.indexOf('Stale - waiting')).toBeLessThan(content.indexOf('Fresh - pending'));
    expect(content).toContain('next user reminder <t:1780491600:F> (0/2 sent)');
    expect(content).toContain(
      'admin: https://discord.com/channels/guild-1/admin-channel-actual/admin-message-1'
    );
    expect(content).toContain('evidence-thread-1');
    expect(content).toContain(
      'source: https://discord.com/channels/guild-1/source-channel-1/source-message-1'
    );
    expect(content).toContain(
      'User-facing support reminders are sent every 24h until the very-stale threshold'
    );
    expect(content).toContain('Very stale cases remain pending for moderator review.');
    expect(content).not.toContain('then moderators should make a final manual call');
    expect(adminSend.mock.calls[0][0].components).toHaveLength(1);
    expect(configService.updateServerSettings).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({
        [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: now.toISOString(),
      })
    );
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(verificationEventRepository.update).not.toHaveBeenCalled();
  });

  it('splits large admin digests on whole line boundaries and only pings roles once', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const adminSend = jest.fn().mockResolvedValue(undefined);
    const { service } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
        case_responder_role_ids: ['123456789012345678'],
        case_responder_routing_mode: 'ping_only',
      }),
      pendingCases: buildLargePendingCases(10, new Date('2026-06-02T10:00:00.000Z')),
      adminSend,
    });

    await service.runOnce(now);

    expect(adminSend.mock.calls.length).toBeGreaterThan(1);
    const payloads = adminSend.mock.calls.map(([payload]) => payload);
    expect(payloads[0].allowedMentions.roles).toEqual(['123456789012345678']);
    expect(payloads[0].components).toHaveLength(1);

    for (const payload of payloads) {
      expect(payload.content.length).toBeLessThanOrEqual(4000);
      const caseLines = payload.content
        .split('\n')
        .filter((line: string) => line.includes('since update'));
      expect(caseLines.every((line: string) => line.startsWith('- <@'))).toBe(true);
    }

    for (const payload of payloads.slice(1)) {
      expect(payload.content).toMatch(/^Case review reminder continued\n/);
      expect(payload.allowedMentions.roles).toEqual([]);
      expect(payload.components).toBeUndefined();
    }
  });

  it('adds a web queue link to the digest when the public web URL is configured', async () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com';
    delete process.env.NEXT_PUBLIC_APP_URL;
    const now = new Date('2026-06-03T12:00:00.000Z');
    const pendingCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'));
    const adminSend = jest.fn().mockResolvedValue(undefined);
    const { service } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
      }),
      pendingCases: [pendingCase],
      adminSend,
    });

    await service.runOnce(now);

    const buttons = adminSend.mock.calls[0][0].components[0].toJSON().components as Array<{
      label?: string;
      url?: string;
    }>;
    expect(buttons.map((button) => button.label)).toEqual(['Open Cases', 'Web Queue']);
    expect(buttons[1]).toMatchObject({
      url: 'https://drasilbot.com/admin/guild/guild-1/cases',
    });
  });

  it('suppresses newly stale admin digests until the server repeat interval elapses', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const newlyStaleCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'), null, {
      thread_id: null,
    });
    const adminSend = jest.fn().mockResolvedValue(undefined);
    const { service, configService, verificationEventRepository } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
        [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: '2026-06-03T10:00:00.000Z',
      }),
      pendingCases: [newlyStaleCase],
      adminSend,
    });

    await service.runOnce(now);

    expect(adminSend).not.toHaveBeenCalled();
    expect(verificationEventRepository.update).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });

  it('sends due user-facing support reminders after the admin review window', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const staleCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'));
    const threadSend = jest.fn().mockResolvedValue(undefined);
    const { service, verificationEventRepository, client } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
        [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: '2026-06-03T10:00:00.000Z',
      }),
      pendingCases: [staleCase],
      threadSend,
    });

    await service.runOnce(now);

    expect(client.channels.fetch).toHaveBeenCalledWith('case-thread-1');
    expect(threadSend).toHaveBeenCalledWith({
      content: 'Ticket reminder: 26h elapsed. <@user-1> See above.',
      allowedMentions: {
        parse: [],
        users: ['user-1'],
        roles: [],
        repliedUser: false,
      },
    });
    expect(verificationEventRepository.update).toHaveBeenCalledWith(
      staleCase.id,
      {
        metadata: {
          support_thread_reminder: {
            lastReminderAt: now.toISOString(),
            reminderCount: 1,
          },
        },
      },
      { touchUpdatedAt: false }
    );
  });

  it('continues user reminders when the admin digest fails to send', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const staleCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'));
    const adminSend = jest.fn().mockRejectedValue(new Error('digest too long'));
    const threadSend = jest.fn().mockResolvedValue(undefined);
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { service, configService, verificationEventRepository } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
      }),
      pendingCases: [staleCase],
      adminSend,
      threadSend,
    });

    try {
      await service.runOnce(now);
    } finally {
      consoleWarn.mockRestore();
    }

    expect(adminSend).toHaveBeenCalled();
    expect(threadSend).toHaveBeenCalledWith({
      content: 'Ticket reminder: 26h elapsed. <@user-1> See above.',
      allowedMentions: {
        parse: [],
        users: ['user-1'],
        roles: [],
        repliedUser: false,
      },
    });
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(verificationEventRepository.update).toHaveBeenCalledWith(
      staleCase.id,
      expect.objectContaining({
        metadata: expect.objectContaining({
          support_thread_reminder: expect.objectContaining({ reminderCount: 1 }),
        }),
      }),
      { touchUpdatedAt: false }
    );
  });

  it('keeps very stale cases pending for moderator review after user reminders are complete', async () => {
    const now = new Date('2026-06-06T12:00:00.000Z');
    const veryStaleCase = buildPendingCase(new Date('2026-06-02T10:00:00.000Z'), {
      support_thread_reminder: {
        lastReminderAt: '2026-06-05T12:00:00.000Z',
        reminderCount: 2,
      },
    });
    const adminSend = jest.fn().mockResolvedValue(undefined);
    const { service, verificationEventRepository, client } = buildService({
      server: buildServer({
        case_review_reminder_stale_hours: 24,
        case_review_reminder_repeat_hours: 24,
        case_review_very_stale_days: 3,
      }),
      pendingCases: [veryStaleCase],
      adminSend,
    });

    await service.runOnce(now);

    const content = adminSend.mock.calls[0][0].content;
    expect(content).toContain('Very stale - awaiting moderator review (1)');
    expect(content).toContain('user reminders sent 2/2; awaiting moderator review');
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(verificationEventRepository.update).not.toHaveBeenCalled();
  });
});
