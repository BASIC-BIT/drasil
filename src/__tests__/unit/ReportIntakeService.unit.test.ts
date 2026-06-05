import { GuildMember, Message, User } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import {
  InMemoryReportIntakeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';
import { ReportIntakeEvidenceKind, ReportIntakeStatus } from '../../repositories/types';
import { IReportCandidateService, ReportCandidate } from '../../services/ReportCandidateService';
import { ReportIntakeService } from '../../services/ReportIntakeService';

const buildReporter = (): GuildMember =>
  ({
    id: 'reporter-1',
    joinedAt: new Date('2025-01-01T00:00:00.000Z'),
    guild: { id: 'guild-1' },
    user: {
      id: 'reporter-1',
      username: 'reporter',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    } as User,
  }) as unknown as GuildMember;

const buildMessage = (overrides: Record<string, unknown> = {}): Message =>
  ({
    id: 'message-1',
    content: 'I want to report this message link',
    channelId: 'thread-1',
    guild: { id: 'guild-1' },
    channel: {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    },
    author: { id: 'reporter-1', bot: false },
    attachments: {
      map: jest.fn((callback: any) => [
        callback({
          id: 'attachment-1',
          name: 'screenshot.png',
          url: 'https://cdn.discordapp.com/screenshot.png',
          proxyURL: 'https://media.discordapp.net/screenshot.png',
          contentType: 'image/png',
          size: 1234,
        }),
      ]),
    },
    ...overrides,
  }) as unknown as Message;

const buildCandidate = (discordUserId = 'user-1'): ReportCandidate => ({
  candidateId: `guild-1:${discordUserId}`,
  discordUserId,
  serverId: 'guild-1',
  username: `target-${discordUserId}`,
  globalName: null,
  displayName: `Target ${discordUserId}`,
  nickname: null,
  avatarUrl: null,
  matchReasons: ['validated Discord message link'],
  confidence: 0.95,
  ambiguityNotes: [],
  platformBackedEvidence: ['validated Discord message link'],
  confirmationRequired: false,
});

describe('ReportIntakeService', () => {
  function buildService(candidateOverrides: Partial<IReportCandidateService> = {}) {
    const reportIntakeRepository = new InMemoryReportIntakeRepository();
    const serverRepository = new InMemoryServerRepository();
    const userRepository = new InMemoryUserRepository();
    const serverMemberRepository = new InMemoryServerMemberRepository();
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({ settings: {} }),
    } as unknown as IConfigService;
    const candidateService: IReportCandidateService = {
      extractCandidateSignals: jest.fn().mockReturnValue({
        mentions: [],
        explicitUserIds: [],
        messageLinks: [
          {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'source-message-1',
            url: 'https://discord.com/channels/guild-1/channel-1/source-message-1',
          },
        ],
      }),
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([buildCandidate()]),
      resolveCandidatesFromSignals: jest.fn().mockResolvedValue([]),
      searchMembersByName: jest.fn().mockResolvedValue([]),
      ...candidateOverrides,
    };
    const service = new ReportIntakeService(
      reportIntakeRepository,
      serverRepository,
      userRepository,
      serverMemberRepository,
      configService,
      candidateService
    );

    return { service, reportIntakeRepository, candidateService };
  }

  it('opens durable intake state for a new report thread', async () => {
    const { service, reportIntakeRepository } = buildService();

    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    const stored = await reportIntakeRepository.findOpenByThreadId('thread-1');
    const openForReporter = await service.findOpenIntakeForReporter({
      serverId: 'guild-1',
      reporterId: 'reporter-1',
    });
    expect(stored).toMatchObject({
      id: intake.id,
      server_id: 'guild-1',
      reporter_id: 'reporter-1',
      status: ReportIntakeStatus.COLLECTING_EVIDENCE,
    });
    expect(openForReporter?.id).toBe(intake.id);
  });

  it('records reporter text, message links, eligible screenshots, and candidate metadata', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    const message = buildMessage();

    const handled = await service.handleThreadMessage(message);

    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    const stored = await reportIntakeRepository.findById(intake.id);
    expect(handled).toBe(true);
    expect(evidence.map((item) => item.kind)).toEqual([
      ReportIntakeEvidenceKind.REPORTER_TEXT,
      ReportIntakeEvidenceKind.MESSAGE_LINK,
      ReportIntakeEvidenceKind.SCREENSHOT,
    ]);
    expect(
      evidence.find((item) => item.kind === ReportIntakeEvidenceKind.MESSAGE_LINK)?.metadata
    ).toMatchObject({
      author_id: 'reporter-1',
    });
    expect(
      evidence.find((item) => item.kind === ReportIntakeEvidenceKind.SCREENSHOT)?.metadata
    ).toMatchObject({
      author_id: 'reporter-1',
    });
    expect(stored?.status).toBe(ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION);
    expect(stored?.metadata).toMatchObject({
      candidate_suggestions: [expect.objectContaining({ discordUserId: 'user-1' })],
      last_confirmation_prompt_candidate_ids: ['user-1'],
    });
    expect((message.channel as any).send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Are you trying to report this person?'),
        allowedMentions: { parse: [] },
      })
    );
    expect((message.channel as any).send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('1. <@user-1>'),
      })
    );
  });

  it('records admin notes without prompting reporter confirmation', async () => {
    const { service, reportIntakeRepository, candidateService } = buildService({
      extractCandidateSignals: jest.fn().mockReturnValue({
        mentions: [],
        explicitUserIds: [],
        messageLinks: [],
      }),
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([buildCandidate()]),
    });
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const message = buildMessage({
      id: 'admin-message-1',
      content: 'Admin note with <@user-1>',
      author: { id: 'admin-1', bot: false },
    });

    await service.handleThreadMessage(message);

    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    const stored = await reportIntakeRepository.findById(intake.id);
    expect(evidence.map((item) => item.kind)).toEqual([ReportIntakeEvidenceKind.ADMIN_NOTE]);
    expect(stored?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(candidateService.extractCandidateSignals).not.toHaveBeenCalled();
    expect(candidateService.resolvePlatformBackedCandidates).not.toHaveBeenCalled();
    expect((message.channel as any).send).not.toHaveBeenCalled();
  });

  it('preserves reporter candidate signals when an admin adds a note', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    await service.handleThreadMessage(buildMessage({ id: 'message-1' }));
    await service.handleThreadMessage(
      buildMessage({
        id: 'admin-message-1',
        content: 'Admin note without reporter candidate signals.',
        author: { id: 'admin-1', bot: false },
      })
    );

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(stored?.metadata).toMatchObject({
      candidate_signals: {
        messageLinks: [expect.objectContaining({ messageId: 'source-message-1' })],
      },
    });
  });

  it('confirms a suggested candidate and builds a submission reason', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    expect(result).toMatchObject({
      confirmed: true,
      reason: expect.stringContaining('Report intake target confirmed by reporter.'),
    });
    expect(stored?.confirmed_target_user_id).toBe('user-1');
    expect(evidence.map((item) => item.kind)).toContain(
      ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );
  });

  it('allows authorized staff to confirm a suggested candidate', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'staff-1',
      confirmedByStaff: true,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    expect(result).toMatchObject({
      confirmed: true,
      reporterId: 'reporter-1',
      reason: expect.stringContaining('Report intake target confirmed by staff.'),
    });
    expect(stored?.confirmed_target_user_id).toBe('user-1');
    expect(evidence).toContainEqual(
      expect.objectContaining({
        kind: ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION,
        metadata: expect.objectContaining({ confirmed_by: 'staff-1' }),
      })
    );
  });

  it('rejects unauthorized candidate confirmations', async () => {
    const { service } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'user-2',
    });

    expect(result).toMatchObject({
      confirmed: false,
      message: 'Only the reporter or staff can confirm this target.',
    });
  });

  it('rejects duplicate confirmations after submission', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());
    await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });
    await service.markSubmitted({
      intakeId: intake.id,
      targetUserId: 'user-1',
      submittedById: 'reporter-1',
    });

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });
    const confirmationEvidence = (await reportIntakeRepository.listEvidence(intake.id)).filter(
      (item) => item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    expect(result).toMatchObject({
      confirmed: false,
      message: 'That report intake is no longer accepting target confirmations.',
    });
    expect(confirmationEvidence).toHaveLength(1);
  });

  it('does not retry submission after a target is already confirmed', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());
    await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });
    const confirmationEvidence = (await reportIntakeRepository.listEvidence(intake.id)).filter(
      (item) => item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    expect(result).toMatchObject({
      confirmed: false,
      message: 'That report target has already been confirmed for this intake.',
    });
    expect(result).not.toHaveProperty('reason');
    expect(confirmationEvidence).toHaveLength(1);
  });

  it('lets the reporter reject suggested candidates without submitting a report', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());
    const storedBeforeReject = await reportIntakeRepository.findById(intake.id);
    const promptToken = (storedBeforeReject?.metadata as Record<string, unknown>)
      .last_confirmation_prompt_token as string;

    const result = await service.rejectCandidates({
      intakeId: intake.id,
      rejectedById: 'reporter-1',
      promptToken,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    expect(result).toMatchObject({ rejected: true });
    expect(stored?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(stored?.metadata).toMatchObject({
      candidate_suggestions: [],
      rejected_candidate_ids: ['user-1'],
      last_rejected_candidate_ids: ['user-1'],
    });
    expect(evidence.map((item) => item.kind)).toContain(
      ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    const followupChannel = {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    };
    await service.handleThreadMessage(buildMessage({ id: 'message-2', channel: followupChannel }));
    const afterFollowup = await reportIntakeRepository.findById(intake.id);
    expect(afterFollowup?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(afterFollowup?.metadata).toMatchObject({ candidate_suggestions: [] });
    expect(followupChannel.send).not.toHaveBeenCalled();

    const analysisPrompted = await service.recordAgentAnalysis({
      intakeId: intake.id,
      message: buildMessage({ id: 'message-3', channel: followupChannel }),
      candidates: [buildCandidate('user-1')],
      evidenceCount: 3,
      imageCount: 1,
    });
    const afterAnalysis = await reportIntakeRepository.findById(intake.id);
    expect(analysisPrompted).toBe(false);
    expect(afterAnalysis?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(afterAnalysis?.metadata).toMatchObject({ candidate_suggestions: [] });
    expect(followupChannel.send).not.toHaveBeenCalled();
  });

  it('allows authorized staff to reject suggested candidates', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());
    const storedBeforeReject = await reportIntakeRepository.findById(intake.id);
    const promptToken = (storedBeforeReject?.metadata as Record<string, unknown>)
      .last_confirmation_prompt_token as string;

    const result = await service.rejectCandidates({
      intakeId: intake.id,
      rejectedById: 'staff-1',
      rejectedByStaff: true,
      promptToken,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(result).toMatchObject({ rejected: true });
    expect(stored?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
  });

  it('ignores stale prompt tokens after a newer target prompt is shown', async () => {
    const { service, reportIntakeRepository } = buildService({
      resolvePlatformBackedCandidates: jest
        .fn()
        .mockResolvedValueOnce([buildCandidate('user-1')])
        .mockResolvedValueOnce([buildCandidate('user-2')]),
    });
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage({ id: 'message-1' }));
    const firstStored = await reportIntakeRepository.findById(intake.id);
    const firstPromptToken = (firstStored?.metadata as Record<string, unknown>)
      .last_confirmation_prompt_token as string;
    await service.handleThreadMessage(buildMessage({ id: 'message-2' }));

    const result = await service.rejectCandidates({
      intakeId: intake.id,
      rejectedById: 'reporter-1',
      promptToken: firstPromptToken,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(result).toMatchObject({
      rejected: false,
      message: 'That target question is no longer current. Please answer the latest prompt.',
    });
    expect(stored?.status).toBe(ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION);
    expect(stored?.metadata).toMatchObject({
      candidate_suggestions: [
        expect.objectContaining({ discordUserId: 'user-1' }),
        expect.objectContaining({ discordUserId: 'user-2' }),
      ],
    });
  });

  it('marks an intake as failed when opening cannot complete', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    await service.markOpenFailed({ intakeId: intake.id, reason: 'thread_activation_failed' });

    const stored = await reportIntakeRepository.findById(intake.id);
    const openForReporter = await service.findOpenIntakeForReporter({
      serverId: 'guild-1',
      reporterId: 'reporter-1',
    });
    expect(stored?.status).toBe(ReportIntakeStatus.EXPIRED);
    expect(stored?.metadata).toMatchObject({ open_failed_reason: 'thread_activation_failed' });
    expect(openForReporter).toBeNull();
  });

  it('rejects reporter self-confirmation', async () => {
    const selfCandidate = {
      ...buildCandidate(),
      candidateId: 'guild-1:reporter-1',
      discordUserId: 'reporter-1',
    };
    const { service, reportIntakeRepository } = buildService({
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([selfCandidate]),
    });
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'reporter-1',
      confirmedById: 'reporter-1',
    });
    const confirmationEvidence = (await reportIntakeRepository.listEvidence(intake.id)).filter(
      (item) => item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    expect(result).toMatchObject({ confirmed: false, message: 'You cannot report yourself.' });
    expect(confirmationEvidence).toHaveLength(0);
  });

  it('keeps earlier candidate suggestions after later evidence has no candidates', async () => {
    const { service, reportIntakeRepository } = buildService({
      resolvePlatformBackedCandidates: jest
        .fn()
        .mockResolvedValueOnce([buildCandidate()])
        .mockResolvedValueOnce([]),
      extractCandidateSignals: jest.fn().mockReturnValue({
        mentions: [],
        explicitUserIds: [],
        messageLinks: [],
      }),
    });
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    await service.handleThreadMessage(buildMessage({ id: 'message-1' }));
    await service.handleThreadMessage(
      buildMessage({ id: 'message-2', content: 'Additional context with no identifiable target.' })
    );

    const stored = await reportIntakeRepository.findById(intake.id);
    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });

    expect(stored?.metadata).toMatchObject({
      candidate_suggestions: [expect.objectContaining({ discordUserId: 'user-1' })],
    });
    expect(result.confirmed).toBe(true);
  });

  it('does not repost confirmation prompts for the same candidates in a different order', async () => {
    const channel = {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = buildService({
      resolvePlatformBackedCandidates: jest
        .fn()
        .mockResolvedValueOnce([buildCandidate('user-1'), buildCandidate('user-2')])
        .mockResolvedValueOnce([buildCandidate('user-2'), buildCandidate('user-1')]),
    });
    await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    await service.handleThreadMessage(buildMessage({ id: 'message-1', channel }));
    await service.handleThreadMessage(buildMessage({ id: 'message-2', channel }));

    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('shows accumulated candidates in later confirmation prompts', async () => {
    const channel = {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = buildService({
      resolvePlatformBackedCandidates: jest
        .fn()
        .mockResolvedValueOnce([buildCandidate('user-1')])
        .mockResolvedValueOnce([buildCandidate('user-2')]),
    });
    await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    await service.handleThreadMessage(buildMessage({ id: 'message-1', channel }));
    await service.handleThreadMessage(buildMessage({ id: 'message-2', channel }));

    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('<@user-1>'),
      })
    );
    expect(channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('<@user-2>'),
      })
    );
  });

  it('lets the reporter close the intake without deleting evidence', async () => {
    const { service, reportIntakeRepository } = buildService({
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([]),
      extractCandidateSignals: jest.fn().mockReturnValue({
        mentions: [],
        explicitUserIds: [],
        messageLinks: [],
      }),
    });
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    const channel = {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
      archived: false,
      setArchived: jest.fn().mockResolvedValue(undefined),
    };
    const message = buildMessage({ content: 'close report', channel });

    await service.handleThreadMessage(message);

    const stored = await reportIntakeRepository.findById(intake.id);
    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    expect(stored?.status).toBe(ReportIntakeStatus.CLOSED_BY_REPORTER);
    expect(stored?.closed_at).toBeInstanceOf(Date);
    expect(evidence).toHaveLength(2);
    expect(channel.send).toHaveBeenCalledWith({
      content: 'Report intake closed. No report has been filed.',
      components: [],
      allowedMentions: { parse: [] },
    });
    expect(channel.setArchived).toHaveBeenCalledWith(true, 'Report intake closed');
  });

  it('closes the current intake thread by slash command for reporter or staff', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    const result = await service.closeIntakeForThread({
      threadId: 'thread-1',
      closedById: 'staff-1',
      closedByStaff: true,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(result).toEqual({
      closed: true,
      message: 'Report intake closed. No report has been filed.',
    });
    expect(stored?.status).toBe(ReportIntakeStatus.CLOSED_BY_REPORTER);
    expect(stored?.metadata).toMatchObject({
      closed_by: 'staff-1',
      closed_reason: 'staff_request',
      closed_by_staff: true,
    });
  });
});
