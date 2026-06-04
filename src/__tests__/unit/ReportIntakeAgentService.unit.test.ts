import { GuildMember, Message, User } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import {
  InMemoryReportIntakeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';
import { ReportIntakeStatus } from '../../repositories/types';
import { IGPTService, ReportIntakeEvidenceExtraction } from '../../services/GPTService';
import { IReportCandidateService, ReportCandidate } from '../../services/ReportCandidateService';
import { ReportIntakeAgentService } from '../../services/ReportIntakeAgentService';
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

const buildCandidate = (discordUserId = 'user-1'): ReportCandidate => ({
  candidateId: `guild-1:${discordUserId}`,
  discordUserId,
  serverId: 'guild-1',
  username: `target-${discordUserId}`,
  globalName: null,
  displayName: `Target ${discordUserId}`,
  nickname: null,
  avatarUrl: null,
  matchReasons: ['AI-extracted intake evidence: explicit Discord ID or mention'],
  confidence: 0.95,
  ambiguityNotes: [],
  platformBackedEvidence: ['AI-extracted intake evidence: explicit Discord ID or mention'],
  confirmationRequired: false,
});

const buildMessage = (overrides: Record<string, unknown> = {}): Message =>
  ({
    id: 'message-1',
    content: '',
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

describe('ReportIntakeAgentService', () => {
  function buildServices() {
    const reportIntakeRepository = new InMemoryReportIntakeRepository();
    const serverRepository = new InMemoryServerRepository();
    const userRepository = new InMemoryUserRepository();
    const serverMemberRepository = new InMemoryServerMemberRepository();
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          report_ai_triage_enabled: true,
          report_ai_analyze_text: true,
          report_ai_analyze_images: true,
        },
      }),
    } as unknown as IConfigService;
    const candidateService: jest.Mocked<IReportCandidateService> = {
      extractCandidateSignals: jest.fn().mockReturnValue({
        mentions: [],
        explicitUserIds: ['user-1'],
        messageLinks: [],
      }),
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([]),
      resolveCandidatesFromSignals: jest.fn().mockResolvedValue([buildCandidate()]),
      searchMembersByName: jest.fn().mockResolvedValue([]),
    };
    const extraction: ReportIntakeEvidenceExtraction = {
      visibleNames: [],
      visibleUsernames: [],
      visibleUserIds: ['user-1'],
      visibleMessageLinks: [],
      quotedMessageText: [],
      platformHints: [],
      abuseSignals: ['screenshot shows suspicious contact request'],
      uncertainty: [],
      confidence: 0.88,
      analyzedImageCount: 1,
      model: 'gpt-test',
      promptVersion: 'report-intake-extraction-v1',
      isFallback: false,
    };
    const gptService: jest.Mocked<Pick<IGPTService, 'extractReportIntakeEvidence'>> = {
      extractReportIntakeEvidence: jest.fn().mockResolvedValue(extraction),
    };
    const intakeService = new ReportIntakeService(
      reportIntakeRepository,
      serverRepository,
      userRepository,
      serverMemberRepository,
      configService,
      candidateService
    );
    const agentService = new ReportIntakeAgentService(
      reportIntakeRepository,
      configService,
      candidateService,
      intakeService,
      gptService as unknown as IGPTService
    );

    return { agentService, intakeService, reportIntakeRepository, candidateService, gptService };
  }

  it('analyzes screenshot-only evidence and asks the reporter for target confirmation', async () => {
    const { agentService, intakeService, reportIntakeRepository, candidateService, gptService } =
      buildServices();
    const intake = await intakeService.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const message = buildMessage();
    await intakeService.handleThreadMessage(message);

    const handled = await agentService.runAnalysisForThreadMessage(message);

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(handled).toBe(true);
    expect(gptService.extractReportIntakeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: 'reporter-1',
        attachments: [expect.objectContaining({ id: 'attachment-1' })],
      })
    );
    expect(candidateService.resolveCandidatesFromSignals).toHaveBeenCalledWith(
      message.guild,
      expect.objectContaining({ explicitUserIds: ['user-1'] }),
      'AI-extracted intake evidence'
    );
    expect(stored?.status).toBe(ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION);
    expect(stored?.metadata).toMatchObject({
      report_intake_agent: {
        evidence_count: 1,
        image_count: 1,
        candidate_count: 1,
      },
      candidate_suggestions: [expect.objectContaining({ discordUserId: 'user-1' })],
    });
    expect((message.channel as any).send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Are you trying to report this person?'),
      })
    );
  });
});
