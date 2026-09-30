import { EmbedBuilder, Guild, GuildMember, ThreadChannel, User } from 'discord.js';
import { NotificationPresentationBuilder } from '../../services/NotificationPresentationBuilder';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import {
  AdminActionType,
  CaptchaChallenge,
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestOutcome,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaptchaProvider,
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  DetectionEvent,
  DetectionType,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { VERIFICATION_ACTION_FAILURES_METADATA_KEY } from '../../utils/verificationActionFailures';

const buildMember = (): GuildMember =>
  ({
    id: 'user-1',
    displayName: 'Server Nick',
    nickname: 'Server Nick',
    joinedAt: new Date('2026-01-02T00:00:00Z'),
    guild: { id: 'guild-1' } as unknown as Guild,
    user: {
      id: 'user-1',
      username: 'test-user',
      tag: 'test-user#0001',
      globalName: 'Global Name',
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
  notification_channel_id: overrides.notification_channel_id ?? null,
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.PENDING,
  case_revision: overrides.case_revision ?? 0,
  case_kind: overrides.case_kind,
  attention_state: overrides.attention_state,
  containment_status: overrides.containment_status,
  created_at: overrides.created_at ?? new Date('2026-01-03T00:00:00Z'),
  updated_at: overrides.updated_at ?? new Date('2026-01-03T00:00:00Z'),
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

const buildCaptchaChallenge = (overrides: Partial<CaptchaChallenge> = {}): CaptchaChallenge => ({
  id: overrides.id ?? 'challenge-1',
  verification_event_id: overrides.verification_event_id ?? 'ver-1',
  server_id: overrides.server_id ?? 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  provider: overrides.provider ?? CaptchaProvider.TURNSTILE,
  status: overrides.status ?? CaptchaChallengeStatus.PENDING,
  request_source: overrides.request_source ?? CaptchaChallengeRequestSource.MODERATOR,
  pass_effect: overrides.pass_effect ?? CaptchaChallengePassEffect.EVIDENCE_ONLY,
  generation: overrides.generation ?? 1,
  case_revision_at_issue: overrides.case_revision_at_issue ?? 0,
  link_token_hash: overrides.link_token_hash ?? 'token-hash',
  expires_at: overrides.expires_at ?? new Date('2026-01-04T00:00:00Z'),
  submission_count: overrides.submission_count ?? 0,
  requested_by: overrides.requested_by ?? 'moderator-1',
  requested_at: overrides.requested_at ?? new Date('2026-01-03T00:00:00Z'),
  delivered_at: overrides.delivered_at ?? null,
  delivery_error_code: overrides.delivery_error_code ?? null,
  passed_at: overrides.passed_at ?? null,
  bypassed_by: overrides.bypassed_by ?? null,
  bypassed_at: overrides.bypassed_at ?? null,
  bypass_reason: overrides.bypass_reason ?? null,
  cancelled_at: overrides.cancelled_at ?? null,
  created_at: overrides.created_at ?? new Date('2026-01-03T00:00:00Z'),
  updated_at: overrides.updated_at ?? new Date('2026-01-03T00:00:00Z'),
  history: overrides.history,
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

  it('renders stored intake reports once with a reporter mention and thread link', () => {
    const reason =
      'Report intake target confirmed by staff.\nReport intake ID: intake-1\nReport thread ID: 1554640900225900658\nEvidence entries: 3\nReporter context: Unsolicited DM.\nPlease review it.';
    const event = buildDetectionEvent({
      detection_type: DetectionType.USER_REPORT,
      metadata: { source: 'report_intake', reporterId: '233815839806193664', reason },
    });
    const detection = buildDetectionResult({
      triggerSource: DetectionType.USER_REPORT,
      detectionEventId: event.id,
      triggerContent: reason,
      reasons: [`Reported by user 233815839806193664. Reason: ${reason}`],
    });
    const anotherReport = buildDetectionEvent({
      id: 'other-report',
      detection_type: DetectionType.USER_REPORT,
      metadata: { reporterId: '999999999999999999', reason: 'A different report' },
    });
    for (const embed of [
      builder.createSuspiciousUserEmbed(buildMember(), detection, buildVerificationEvent(), [
        event,
      ]),
      builder.createObservedDetectionEmbed(buildMember(), detection, [anotherReport, event]),
    ]) {
      expect(getField(embed, 'Report')).toBe(
        'Reported by <@233815839806193664> · [View report](https://discord.com/channels/guild-1/1554640900225900658)\nUnsolicited DM.\nPlease review it.'
      );
      expect(getField(embed, 'Trigger')).toBeUndefined();
      expect(getField(embed, 'Reasons')).toBeUndefined();
      expect(getField(embed, 'Report Signal')).toBeUndefined();
      expect(JSON.stringify(embed.toJSON())).not.toContain('intake-1');
      expect(JSON.stringify(embed.toJSON())).not.toContain('Evidence entries');
    }
    const caseEmbed = builder.createSuspiciousUserEmbed(
      buildMember(),
      detection,
      buildVerificationEvent(),
      [event]
    );
    expect(caseEmbed.data.description).toBe(
      '<@user-1> has an open case awaiting moderator review.'
    );
    expect(getField(caseEmbed, 'Detection History')).toBeUndefined();
    const multipleEvents = builder.createSuspiciousUserEmbed(
      buildMember(),
      detection,
      buildVerificationEvent(),
      [event, anotherReport]
    );
    expect(getField(multipleEvents, 'Detection History')).toContain('user report');
  });

  it('keeps ordinary report reasons and handles missing or invalid report metadata', () => {
    const detection = buildDetectionResult({
      triggerSource: DetectionType.USER_REPORT,
      triggerContent: 'Please review this message.\nEvidence entries: this is reporter text.',
      detectionEventId: 'missing',
    });
    const embed = builder.createSuspiciousUserEmbed(
      buildMember(),
      detection,
      buildVerificationEvent(),
      [buildDetectionEvent({ metadata: { reporterId: 'wrong-reporter', reason: 'Wrong reason' } })]
    );
    expect(getField(embed, 'Report')).toBe(
      'Reported by a user\nPlease review this message.\nEvidence entries: this is reporter text.'
    );
    const invalidMetadata = builder.createObservedDetectionEmbed(
      buildMember(),
      { ...detection, detectionEventId: 'event-1' },
      [
        buildDetectionEvent({
          detection_type: DetectionType.USER_REPORT,
          metadata: { reporterId: '@everyone', reason: 'Review this DM.' },
        }),
      ]
    );
    expect(getField(invalidMetadata, 'Report')).toBe('Reported by a user\nReview this DM.');
  });

  it('omits intake routing details when no reporter context was provided', () => {
    const reason =
      'Report intake target confirmed by reporter.\nReport intake ID: intake-2\nEvidence entries: 2';
    const embed = builder.createObservedDetectionEmbed(
      buildMember(),
      buildDetectionResult({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: reason,
        detectionEventId: 'event-1',
      }),
      [
        buildDetectionEvent({
          detection_type: DetectionType.USER_REPORT,
          metadata: { source: 'report_intake', reporterId: '233815839806193664', reason },
        }),
      ]
    );
    expect(getField(embed, 'Report')).toBe('Reported by <@233815839806193664>');
    expect(getField(embed, 'Recent Detection History')).toBeUndefined();
  });

  it('keeps the latest action once and retains earlier distinct actions', () => {
    const embed = new EmbedBuilder();
    builder.upsertAdminActionLog(embed, AdminActionType.OPEN_CASE, 'admin-1', 1800000000);
    expect(getField(embed, 'Action Log')).toBeUndefined();
    builder.upsertAdminActionLog(embed, AdminActionType.OPEN_CASE, 'admin-1', 1800000000);
    expect(getField(embed, 'Action Log')).toBeUndefined();
    builder.upsertAdminActionLog(embed, AdminActionType.VERIFY, 'admin-2', 1800000100);
    expect(getField(embed, 'Action Log')).toBe('• Opened case by <@admin-1> at <t:1800000000:F>');
    expect(getField(embed, 'Latest Admin Action')).toBe(
      'Verified by <@admin-2> at <t:1800000100:F>'
    );
  });

  it('compacts successful quarantine while keeping incomplete-removal warnings', () => {
    const restriction = {
      status: 'quarantined',
      mode: 'on',
      removed_role_count: 12,
      planned_role_count: 12,
      skipped_role_count: 0,
      failed_removal_count: 0,
    };
    const successful = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult(),
      buildVerificationEvent({ metadata: { role_quarantine: { restriction } } }),
      []
    );
    expect(getField(successful, 'Role Quarantine')).toBe('Active · 12 roles removed');
    const incomplete = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult(),
      buildVerificationEvent({
        metadata: {
          role_quarantine: {
            restriction: { ...restriction, removed_role_count: 10, failed_removal_count: 2 },
          },
        },
      }),
      []
    );
    expect(getField(incomplete, 'Role Quarantine')).toContain('removed 10 of 12');
    expect(getField(incomplete, 'Role Quarantine')).toContain('failed 2');
  });

  it('preserves report wording when a handled case is reopened or an observed action is undone', () => {
    const result = buildDetectionResult({ triggerSource: DetectionType.USER_REPORT });
    const embed = builder.createSuspiciousUserEmbed(
      buildMember(),
      result,
      buildVerificationEvent({ status: VerificationStatus.VERIFIED }),
      []
    );
    builder.upsertResolvedCasePresentation(
      embed,
      buildVerificationEvent(),
      VerificationStatus.PENDING
    );
    expect(embed.data.title).toBe('Moderation Case Opened');
    expect(embed.data.description).toBe('<@user-1> has an open case awaiting moderator review.');
    const observed = builder.createObservedDetectionEmbed(buildMember(), result, []);
    builder.addObservedActionTakenField(
      observed,
      'opened a case',
      'admin-1',
      1800000000,
      AdminActionType.OPEN_CASE
    );
    builder.addObservedActionRevertedField(observed, 'undid the action', 'admin-1', 1800000100);
    expect(observed.data.description).toBe(
      '<@user-1> was reported by a user. No case was opened automatically.'
    );
  });

  it('shows both classifier results when they disagree', () => {
    const embed = builder.createObservedDetectionEmbed(
      buildMember(),
      buildDetectionResult({
        gptAnalysis: {
          result: 'OK',
          confidence: 0.2,
          reasons: [],
          reasonCodes: ['normal_context'],
          primarySignal: 'none',
          summary: 'Context looks normal.',
          model: 'gpt-5.4-mini',
          promptVersion: 'test',
          isFallback: false,
        },
        jevAnalysis: {
          result: 'SUSPICIOUS',
          suspiciousProbability: 0.91,
          reasonCodes: ['scam_link'],
          model: 'jev-1.13.0',
        },
      }),
      []
    );

    expect(getField(embed, 'Risk Analysis')).toContain(
      'Two checks: GPT did not flag; Jev flagged.'
    );
    expect(getField(embed, 'Risk Analysis')).toContain('Jev reason: scam_link');
  });

  it('shows both report and verification text verdicts to moderators', () => {
    const reportEmbed = builder.createObservedDetectionEmbed(
      buildMember(),
      buildDetectionResult({
        reportAiAnalysis: {
          gptResult: 'low_risk',
          gptSummary: 'No abuse found in the reported message.',
          jevAnalysis: {
            result: 'SUSPICIOUS',
            suspiciousProbability: 0.9,
            reasonCodes: ['scam_link'],
            model: 'jev-test',
          },
          result: 'needs_review',
          confidence: 0.9,
          summary: 'Needs moderator review.',
          reasonCodes: ['scam_link'],
          evidenceCategories: [],
          concerns: [],
          recommendedAction: 'manual_review',
          analyzedImageCount: 0,
          model: 'gpt-test',
          promptVersion: 'report-test',
          isFallback: false,
        },
      }),
      []
    );
    expect(getField(reportEmbed, 'Report Triage')).toContain('GPT did not flag; Jev flagged');
    expect(getField(reportEmbed, 'Report Triage')).toContain(
      'No abuse found in the reported message.'
    );
    expect(getField(reportEmbed, 'Report Triage')).toContain('Jev reason: scam_link');

    const replyEmbed = new EmbedBuilder();
    builder.upsertThreadAnalysisField(
      replyEmbed,
      {
        gptResult: 'likely_legitimate',
        gptSummary: 'The member answered the questions directly.',
        jevAnalysis: {
          result: 'UNAVAILABLE',
          suspiciousProbability: null,
          reasonCodes: [],
          model: 'jev-test',
        },
        result: 'likely_legitimate',
        confidence: 0.8,
        summary: 'The member answered the questions directly.',
        reasonCodes: [],
        legitimacySignals: [],
        suspicionSignals: [],
        recommendedAction: 'manual_review',
        model: 'gpt-test',
        promptVersion: 'reply-test',
        isFallback: false,
      },
      1
    );
    expect(
      getField(replyEmbed, NotificationPresentationBuilder.THREAD_ANALYSIS_FIELD_NAME)
    ).toContain('GPT did not flag; Jev unavailable');
    expect(
      getField(replyEmbed, NotificationPresentationBuilder.THREAD_ANALYSIS_FIELD_NAME)
    ).toContain('The member answered the questions directly.');
  });

  it('replaces the typed browser security-check field as the challenge advances', () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User');
    builder.upsertCaptchaChallengePresentation(
      embed,
      buildCaptchaChallenge({
        generation: 2,
        submission_count: 1,
        delivery_error_code: 'discord_delivery_failed',
      })
    );

    expect(getField(embed, NotificationPresentationBuilder.CAPTCHA_FIELD_NAME)).toContain(
      'Status: Pending'
    );
    expect(getField(embed, NotificationPresentationBuilder.CAPTCHA_FIELD_NAME)).toContain(
      'Generation: 2 · Submissions: 1'
    );
    expect(getField(embed, NotificationPresentationBuilder.CAPTCHA_FIELD_NAME)).toContain(
      'Link delivery: failed (discord delivery failed)'
    );

    builder.upsertCaptchaChallengePresentation(
      embed,
      buildCaptchaChallenge({
        generation: 2,
        status: CaptchaChallengeStatus.BYPASSED,
        bypassed_at: new Date('2026-01-03T01:00:00Z'),
        bypassed_by: 'moderator-2',
        bypass_reason: 'Identity confirmed another way',
      })
    );

    const captchaFields = (embed.data.fields ?? []).filter(
      (field) => field.name === NotificationPresentationBuilder.CAPTCHA_FIELD_NAME
    );
    expect(captchaFields).toHaveLength(1);
    expect(captchaFields[0].value).toContain('Status: Bypassed by moderator');
    expect(captchaFields[0].value).toContain('by <@moderator-2>');
    expect(captchaFields[0].value).toContain('Bypass reason: Identity confirmed another way');
    expect(captchaFields[0].value).not.toContain('Expires:');
  });

  it('shows bounded prior CAPTCHA generations in the admin notification', () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User');
    builder.upsertCaptchaChallengePresentation(
      embed,
      buildCaptchaChallenge({
        generation: 3,
        history: [
          {
            generation: 1,
            request_source: CaptchaChallengeRequestSource.MODERATOR,
            pass_effect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
            case_revision_at_issue: 0,
            requested_by: 'moderator-1',
            requested_at: new Date('2026-01-01T00:00:00Z'),
            presented_at: null,
            outcome: null,
            outcome_at: null,
            delivery_error_code: 'discord_delivery_failed',
            bypassed_by: null,
            bypassed_at: null,
            bypass_reason: null,
          },
          {
            generation: 2,
            request_source: CaptchaChallengeRequestSource.MODERATOR,
            pass_effect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
            case_revision_at_issue: 0,
            requested_by: 'moderator-2',
            requested_at: new Date('2026-01-02T00:00:00Z'),
            presented_at: new Date('2026-01-02T00:01:00Z'),
            outcome: CaptchaChallengeRequestOutcome.BYPASSED,
            outcome_at: new Date('2026-01-02T00:02:00Z'),
            delivery_error_code: null,
            bypassed_by: 'moderator-2',
            bypassed_at: new Date('2026-01-02T00:02:00Z'),
            bypass_reason: 'Identity confirmed',
          },
        ],
      })
    );

    const field = getField(embed, NotificationPresentationBuilder.CAPTCHA_FIELD_NAME);
    expect(field).toContain('Previous generations:');
    expect(field).toContain('• 1: no outcome recorded, delivery failed (discord delivery failed)');
    expect(field).toContain(
      '• 2: bypassed, no delivery failure recorded, bypass: Identity confirmed'
    );
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
    expect(getField(embed, 'User')).toBe(
      '<@user-1> (Discord username: `test-user`; Display name: `Global Name`; Server nickname: `Server Nick`)'
    );
    expect(getField(embed, 'User ID')).toBe('user-1');
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
    expect(getField(embed, 'Action Log')).toBe('• Verified by <@admin-1> at <t:1800000000:F>');
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

  it('fronts departed membership when rendering pending case notifications', () => {
    const embed = builder.createSuspiciousUserEmbed(
      buildMember(),
      buildDetectionResult(),
      buildVerificationEvent({
        metadata: {
          membership_state: 'left_or_removed',
          member_left_at: '2026-01-05T00:00:00.000Z',
        },
      }),
      []
    );

    expect(embed.data.title).toBe('Member Left Server');
    expect(embed.data.color).toBe(0xffc107);
    expect(embed.data.description).toContain(
      'left or was removed while this case is still pending'
    );
    expect(getField(embed, 'Membership')).toContain('Left or removed at <t:1767571200:F>');
  });

  it('clears stale handled presentation when refreshing a pending case', () => {
    const embed = new EmbedBuilder()
      .setTitle('Case Handled: Verified')
      .setDescription('<@user-1> has been handled. No further moderator action is pending.')
      .setColor(0x00ff00)
      .addFields(
        {
          name: 'Resolution',
          value:
            'Verified by <@admin-1> at <t:1767571200:F>\nNo further moderator action is pending.',
          inline: false,
        },
        { name: 'User ID', value: 'user-1', inline: true },
        { name: 'Trigger', value: 'Flagged via user report: `scam DM`', inline: false },
        { name: 'Latest Admin Action', value: 'Reopened by <@admin-2>', inline: false },
        { name: 'Action Log', value: 'Reopened by <@admin-2>', inline: false }
      );

    builder.upsertResolvedCasePresentation(
      embed,
      buildVerificationEvent({ status: VerificationStatus.PENDING }),
      VerificationStatus.PENDING
    );

    expect(embed.data.title).toBe('User Report Submitted');
    expect(embed.data.description).toBe('<@user-1> has been flagged as suspicious.');
    expect(embed.data.color).toBe(0xff0000);
    expect(getField(embed, 'Resolution')).toBeUndefined();
    expect(getField(embed, 'Latest Admin Action')).toBe('Reopened by <@admin-2>');
    expect(getField(embed, 'Action Log')).toBe('Reopened by <@admin-2>');
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

    expect(reportEmbed.data.title).toBe('Moderation Case Opened');
    expect(adminCaseEmbed.data.title).toBe('Admin Review Case Opened');
  });

  it('keeps user-facing case prompts behind the compact admin actions entry point', () => {
    const row = builder.createActionRow('user-1');
    const buttons = row.toJSON().components as Array<{ label?: string; custom_id?: string }>;

    expect(buttons.map((button) => button.label)).toEqual(['Admin Actions']);
    expect(buttons[0].custom_id).toBe('admin_actions:m:c:user-1');
  });

  it('adds primary admin actions and optional web links to admin notification rows', () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com';
    delete process.env.NEXT_PUBLIC_APP_URL;

    const caseRows = builder.createAdminNotificationActionRows('user-1', {
      guildId: 'guild-1',
      verificationEventId: 'ver-1',
    });
    const observedRows = builder.createObservedActionRows('user-1', 'det-1', 'guild-1');
    const observedReportRows = builder.createObservedActionRows('user-1', 'det-1', 'guild-1', {
      kind: 'report',
    });

    const caseButtons = caseRows.flatMap(
      (row) => row.toJSON().components as Array<{ label?: string; url?: string }>
    );
    const observedButtons = observedRows.flatMap(
      (row) =>
        row.toJSON().components as Array<{
          label?: string;
          custom_id?: string;
          url?: string;
        }>
    );
    const observedReportButtons = observedReportRows.flatMap(
      (row) =>
        row.toJSON().components as Array<{
          label?: string;
          custom_id?: string;
          url?: string;
        }>
    );

    expect(caseButtons.map((button) => button.label)).toEqual([
      'Verify',
      'Ban...',
      'Close',
      'Other Actions',
      'Web Case',
    ]);
    expect(caseButtons[4]).toMatchObject({
      url: 'https://drasilbot.com/admin/guild/guild-1/cases/ver-1',
    });
    expect(observedButtons.map((button) => button.label)).toEqual([
      'Open Case',
      'Ban...',
      'Dismiss',
      'Other Actions',
      'Web Queue',
    ]);
    expect(observedReportButtons.map((button) => button.label)).toEqual([
      'Open Case',
      'Ban...',
      'Close Report',
      'Other Actions',
      'Web Queue',
    ]);
    expect(observedButtons[2].custom_id).toBe('observed:dismiss:user-1:det-1');
    expect(observedReportButtons[2].custom_id).toBe('observed:close_report:user-1:det-1');
    expect(observedButtons[4]).toMatchObject({
      url: 'https://drasilbot.com/admin/guild/guild-1/inbox',
    });
  });

  it('uses departed-case admin notification rows with ban-by-id actions', () => {
    const rows = builder.createAdminNotificationActionRows('user-1', {
      guildId: 'guild-1',
      verificationEventId: 'ver-1',
      verificationStatus: VerificationStatus.PENDING,
      caseMembershipState: 'left_or_removed',
    });
    const buttons = rows.flatMap(
      (row) => row.toJSON().components as Array<{ label?: string; custom_id?: string }>
    );

    expect(buttons.map((button) => button.label)).toEqual([
      'History',
      'Ban by ID...',
      'Close',
      'Other Actions',
    ]);
    expect(buttons.map((button) => button.custom_id)).toEqual([
      'history_user-1',
      'ban_user-1',
      'close_user-1',
      'admin_actions:m:c:user-1:_:ver-1',
    ]);
  });

  it('removes close actions from parked quarantine notification rows', () => {
    const rows = builder.createAdminNotificationActionRows('user-1', {
      verificationStatus: VerificationStatus.PENDING,
      caseAttentionState: CaseAttentionState.PARKED,
    });
    const buttons = rows.flatMap(
      (row) => row.toJSON().components as Array<{ label?: string; custom_id?: string }>
    );

    expect(buttons.map((button) => button.label)).toEqual(['Verify', 'Ban...', 'Other Actions']);
    expect(buttons.map((button) => button.custom_id)).not.toContain('close_user-1');
  });

  it.each(['in_server', 'left_or_removed'] as const)(
    'removes close actions from incomplete compromised notification rows when membership is %s',
    (caseMembershipState) => {
      const rows = builder.createAdminNotificationActionRows('user-1', {
        verificationStatus: VerificationStatus.PENDING,
        caseKind: CaseKind.COMPROMISED_ACCOUNT,
        caseAttentionState: CaseAttentionState.REVIEW_REQUIRED,
        caseMembershipState,
      });
      const buttons = rows.flatMap(
        (row) => row.toJSON().components as Array<{ label?: string; custom_id?: string }>
      );

      expect(buttons.map((button) => button.label)).not.toContain('Close');
      expect(buttons.map((button) => button.custom_id)).not.toContain('close_user-1');
      expect(buttons.map((button) => button.label)).toContain('Other Actions');
    }
  );

  it('renders incomplete quarantine blockers prominently in notifications', () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User');
    builder.upsertAccountQuarantinePresentation(
      embed,
      buildVerificationEvent({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        metadata: {
          account_quarantine: {
            removed_role_ids: ['role-1'],
            retained_roles: [{ role_id: 'role-2' }],
            failed_removals: [{ role_id: 'role-3' }],
            member_bypasses: [{ channel_id: 'channel-1' }],
          },
        },
      })
    );

    expect(embed.data.title).toBe('Account Quarantine Needs Review');
    expect(getField(embed, 'Account Quarantine')).toContain('Containment is incomplete');
    expect(getField(embed, 'Account Quarantine')).toContain('Removed roles: 1');
    expect(getField(embed, 'Account Quarantine')).toContain('Permission bypasses: 1');
  });

  it('renders partial-failure details in the persistent quarantine notification', () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User');
    builder.upsertAccountQuarantinePresentation(
      embed,
      buildVerificationEvent({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        metadata: {
          account_quarantine: {
            result: 'failed',
            failure_stage: 'case_role_assignment',
            error: 'Missing permissions',
            removed_role_ids: ['role-1'],
          },
        },
      })
    );

    expect(getField(embed, 'Account Quarantine')).toContain(
      'Containment attempt failed during case role assignment: Missing permissions'
    );
    expect(getField(embed, 'Account Quarantine')).toContain('Removed roles: 1');
  });

  it('collapses observed action rows after an observed alert is actioned', () => {
    const rows = builder.createObservedActionRows('user-1', 'det-1', 'guild-1', {
      actioned: true,
    });
    const buttons = rows.flatMap(
      (row) => row.toJSON().components as Array<{ label?: string; custom_id?: string }>
    );

    expect(buttons.map((button) => button.label)).toEqual(['Other Actions']);
    expect(buttons[0].custom_id).toBe('admin_actions:m:o:user-1:det-1');
  });

  it('uses resolved-case admin notification rows after a case is handled', () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com';

    const rows = builder.createAdminNotificationActionRows('user-1', {
      guildId: 'guild-1',
      verificationEventId: 'ver-1',
      verificationStatus: VerificationStatus.VERIFIED,
    });
    const buttons = rows.flatMap(
      (row) => row.toJSON().components as Array<{ label?: string; custom_id?: string }>
    );

    expect(buttons.map((button) => button.label)).toEqual([
      'Reopen',
      'History',
      'Other Actions',
      'Web Case',
    ]);
    expect(buttons[0].custom_id).toBe('reopen_user-1');
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

  it('formats report intake reporter identity with mention and text identifiers', () => {
    const embed = builder.createReportIntakeStartedEmbed(buildMember(), {
      id: 'thread-1',
      url: 'https://discord.com/channels/guild-1/thread-1',
    } as ThreadChannel);

    expect(getField(embed, 'Reporter')).toBe(
      '<@user-1> (Discord username: `test-user`; Display name: `Global Name`; Server nickname: `Server Nick`)'
    );
  });
});
