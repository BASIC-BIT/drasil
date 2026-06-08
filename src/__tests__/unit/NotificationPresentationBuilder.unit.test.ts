import { EmbedBuilder, Guild, GuildMember, User } from 'discord.js';
import { NotificationPresentationBuilder } from '../../services/NotificationPresentationBuilder';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import {
  AdminActionType,
  DetectionEvent,
  DetectionType,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { VERIFICATION_ACTION_FAILURES_METADATA_KEY } from '../../utils/verificationActionFailures';

const buildMember = (): GuildMember =>
  ({
    id: 'user-1',
    joinedAt: new Date('2026-01-02T00:00:00Z'),
    guild: { id: 'guild-1' } as unknown as Guild,
    user: {
      id: 'user-1',
      tag: 'test-user#0001',
      createdTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png'),
    } as unknown as User,
  }) as unknown as GuildMember;

const buildDetectionResult = (overrides: Partial<DetectionResult> = {}): DetectionResult => ({
  label: 'SUSPICIOUS',
  confidence: 0.9,
  reasons: ['Suspicious content'],
  triggerSource: DetectionType.ADMIN_CASE,
  triggerContent: 'Manual review',
  ...overrides,
});

const buildDetectionEvent = (overrides: Partial<DetectionEvent> = {}): DetectionEvent => ({
  id: overrides.id ?? 'event-1',
  server_id: overrides.server_id ?? 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  thread_id: overrides.thread_id ?? null,
  message_id: overrides.message_id ?? null,
  channel_id: overrides.channel_id ?? null,
  detection_type: overrides.detection_type ?? DetectionType.ADMIN_CASE,
  confidence: overrides.confidence ?? 0.9,
  reasons: overrides.reasons ?? ['Suspicious content'],
  detected_at: overrides.detected_at ?? new Date('2026-01-03T00:00:00Z'),
  latest_verification_event_id: overrides.latest_verification_event_id ?? null,
  metadata: overrides.metadata,
  admin_actions: overrides.admin_actions,
});

const buildVerificationEvent = (overrides: Partial<VerificationEvent> = {}): VerificationEvent => ({
  id: overrides.id ?? 'ver-1',
  server_id: overrides.server_id ?? 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  detection_event_id: overrides.detection_event_id ?? null,
  thread_id: overrides.thread_id ?? null,
  private_evidence_thread_id: overrides.private_evidence_thread_id ?? null,
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.PENDING,
  created_at: overrides.created_at ?? new Date('2026-01-03T00:00:00Z'),
  updated_at: overrides.updated_at ?? new Date('2026-01-03T00:00:00Z'),
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

const getField = (embed: EmbedBuilder, name: string): string | undefined =>
  embed.data.fields?.find((field) => field.name === name)?.value;

describe('NotificationPresentationBuilder (unit)', () => {
  const builder = new NotificationPresentationBuilder();
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

  it('formats case thread links and newest-first detection history labels', () => {
    const embed = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult({ triggerSource: DetectionType.ADMIN_FLAG, triggerContent: 'triage' }),
      buildVerificationEvent({
        thread_id: 'thread-1',
        private_evidence_thread_id: 'evidence-thread-1',
        status: VerificationStatus.VERIFIED,
        resolved_by: 'admin-1',
      }),
      [
        buildDetectionEvent({
          id: 'older',
          detection_type: DetectionType.SUSPICIOUS_CONTENT,
          detected_at: new Date('2026-01-01T00:00:00Z'),
        }),
        buildDetectionEvent({
          id: 'newer',
          detection_type: DetectionType.ROLE_INTAKE,
          detected_at: new Date('2026-01-04T00:00:00Z'),
          message_id: 'message-1',
          channel_id: 'channel-1',
        }),
      ]
    );

    expect(getField(embed, 'Trigger')).toBe('Admin flag: triage');
    expect(getField(embed, 'Case Threads')).toBe(
      'Verification/review thread: https://discord.com/channels/guild-1/thread-1 status: verified by <@admin-1>\n' +
        'Admin evidence thread: https://discord.com/channels/guild-1/evidence-thread-1'
    );
    expect(getField(embed, 'Detection History')).toContain('role intake');
    expect(getField(embed, 'Detection History')?.indexOf('role intake')).toBeLessThan(
      getField(embed, 'Detection History')?.indexOf('suspicious content') ?? Number.MAX_VALUE
    );
    expect(getField(embed, 'Detection History')).toContain(
      'message: https://discord.com/channels/guild-1/channel-1/message-1'
    );
  });

  it('updates latest admin action and appends action log entries', () => {
    const embed = new EmbedBuilder().addFields({
      name: 'Detection Confidence',
      value: 'High',
      inline: true,
    });

    builder.upsertAdminActionLog(
      embed,
      AdminActionType.VERIFY,
      'admin-1',
      1_800_000_000,
      undefined,
      true
    );
    builder.upsertAdminActionLog(
      embed,
      AdminActionType.BAN,
      'admin-2',
      1_800_000_100,
      undefined,
      true
    );

    expect(embed.data.color).toBe(0x000000);
    expect(embed.data.title).toBe('Case Handled: Banned');
    expect(embed.data.fields?.map((field) => field.name)).toEqual([
      'Resolution',
      'Detection Confidence',
      'Latest Admin Action',
      'Action Log',
    ]);
    expect(getField(embed, 'Resolution')).toBe(
      'Banned by <@admin-2> at <t:1800000100:F>\nNo further moderator action is pending.'
    );
    expect(getField(embed, 'Latest Admin Action')).toBe('Banned by <@admin-2> at <t:1800000100:F>');
    expect(getField(embed, 'Action Log')).toBe(
      '• Verified by <@admin-1> at <t:1800000000:F>\n' +
        '• Banned by <@admin-2> at <t:1800000100:F>'
    );
  });

  it('fronts handled status when rendering resolved case notifications', () => {
    const embed = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult(),
      buildVerificationEvent({
        status: VerificationStatus.BANNED,
        resolved_by: 'admin-1',
        resolved_at: new Date('2026-01-05T00:00:00Z'),
      }),
      []
    );

    expect(embed.data.title).toBe('Case Handled: Banned');
    expect(embed.data.description).toBe(
      '<@user-1> has been handled. No further moderator action is pending.'
    );
    expect(embed.data.fields?.[0].name).toBe('Resolution');
    expect(getField(embed, 'Resolution')).toBe(
      'Banned by <@admin-1> at <t:1767571200:F>\nNo further moderator action is pending.'
    );
  });

  it('uses specific pending titles for reports and admin-opened cases', () => {
    const reportEmbed = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult({ triggerSource: DetectionType.USER_REPORT }),
      buildVerificationEvent(),
      []
    );
    const adminCaseEmbed = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult({ triggerSource: DetectionType.ADMIN_CASE }),
      buildVerificationEvent(),
      []
    );

    expect(reportEmbed.data.title).toBe('User Report Submitted');
    expect(adminCaseEmbed.data.title).toBe('Admin Review Case Opened');
  });

  it('adds optional web links to action rows when a public web URL is configured', () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com';
    delete process.env.NEXT_PUBLIC_APP_URL;

    const caseRow = builder.createActionRow('user-1', {
      guildId: 'guild-1',
      verificationEventId: 'ver-1',
    });
    const observedRows = builder.createObservedActionRows('user-1', 'det-1', 'guild-1');

    const caseButtons = caseRow.toJSON().components as Array<{ label?: string; url?: string }>;
    const observedButtons = observedRows[0].toJSON().components as Array<{
      label?: string;
      url?: string;
    }>;

    expect(caseButtons.map((button) => button.label)).toEqual(['Admin Actions', 'Web Case']);
    expect(caseButtons[1]).toMatchObject({
      url: 'https://drasilbot.com/admin/guild/guild-1/cases/ver-1',
    });
    expect(observedButtons.map((button) => button.label)).toEqual(['Admin Actions', 'Web Queue']);
    expect(observedButtons[1]).toMatchObject({
      url: 'https://drasilbot.com/admin/guild/guild-1/cases',
    });
  });

  it('adds and removes moderation action failure warnings', () => {
    const embed = new EmbedBuilder();

    builder.upsertVerificationActionFailureField(
      embed,
      buildVerificationEvent({
        metadata: {
          [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: [
            {
              action: 'private_evidence_thread',
              at: '2026-01-01T00:00:00Z',
              message: 'Missing thread permissions',
            },
          ],
        },
      })
    );

    expect(getField(embed, 'Moderation Action Warning')).toContain(
      'Warning: Create admin evidence thread failed'
    );

    builder.upsertVerificationActionFailureField(embed, buildVerificationEvent({ metadata: {} }));

    expect(getField(embed, 'Moderation Action Warning')).toBeUndefined();
  });

  it('formats observed admin and role-intake triggers', () => {
    const adminCaseEmbed = builder.createObservedDetectionEmbed(
      buildMember(),
      buildDetectionResult({ triggerSource: DetectionType.ADMIN_CASE, triggerContent: '' }),
      []
    );
    const roleIntakeEmbed = builder.createObservedDetectionEmbed(
      buildMember(),
      buildDetectionResult({
        triggerSource: DetectionType.ROLE_INTAKE,
        triggerContent: 'new role',
      }),
      []
    );

    expect(getField(adminCaseEmbed, 'Trigger')).toBe(
      'Observed via admin-opened case: Manual review'
    );
    expect(getField(roleIntakeEmbed, 'Trigger')).toBe('Observed via role intake: new role');
  });
});
