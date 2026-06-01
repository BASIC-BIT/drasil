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

const buildCandidate = (): ReportCandidate => ({
  candidateId: 'guild-1:user-1',
  discordUserId: 'user-1',
  serverId: 'guild-1',
  username: 'target-user',
  globalName: null,
  displayName: 'Target User',
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
    expect(stored).toMatchObject({
      id: intake.id,
      server_id: 'guild-1',
      reporter_id: 'reporter-1',
      status: ReportIntakeStatus.COLLECTING_EVIDENCE,
    });
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
    expect(stored?.status).toBe(ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION);
    expect(stored?.metadata).toMatchObject({
      candidate_suggestions: [expect.objectContaining({ discordUserId: 'user-1' })],
      last_confirmation_prompt_candidate_ids: ['user-1'],
    });
    expect((message.channel as any).send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please confirm the correct target'),
        allowedMentions: { parse: [] },
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
    expect(evidence.map((item) => item.kind)).toContain(ReportIntakeEvidenceKind.ADMIN_NOTE);
    expect(stored?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(candidateService.resolvePlatformBackedCandidates).not.toHaveBeenCalled();
    expect((message.channel as any).send).not.toHaveBeenCalled();
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

    await service.handleThreadMessage(buildMessage({ content: 'close report' }));

    const stored = await reportIntakeRepository.findById(intake.id);
    const evidence = await reportIntakeRepository.listEvidence(intake.id);
    expect(stored?.status).toBe(ReportIntakeStatus.CLOSED_BY_REPORTER);
    expect(stored?.closed_at).toBeInstanceOf(Date);
    expect(evidence).toHaveLength(2);
  });
});
