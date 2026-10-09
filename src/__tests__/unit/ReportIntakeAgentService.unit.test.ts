import { createTracingRecorder } from '../fakes/recordingTracing';
import { withObservation } from '../../observability/langfuse';
import { GuildMember, Message, User } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import {
  InMemoryReportIntakeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';
import { ReportIntakeEvidenceKind, ReportIntakeStatus } from '../../repositories/types';
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
  matchReasons: ['intake evidence: explicit Discord ID or mention'],
  confidence: 0.95,
  ambiguityNotes: [],
  platformBackedEvidence: ['intake evidence: explicit Discord ID or mention'],
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
      'intake evidence'
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
  it.each(['no-candidates', 'lookup-failure', 'send-failure', 'persistence-failure'] as const)(
    'tracks the full intake outcome for %s',
    async (mode) => {
      const { agentService, intakeService, reportIntakeRepository, candidateService } =
        buildServices();
      const intake = await intakeService.openIntakeFromThread({
        serverId: 'guild-1',
        reporter: buildReporter(),
        threadId: 'thread-1',
        channelId: 'channel-1',
      });
      const message = buildMessage();
      await intakeService.handleThreadMessage(message);
      const recorder = createTracingRecorder();
      try {
        if (mode === 'no-candidates')
          candidateService.resolveCandidatesFromSignals.mockResolvedValue([]);
        if (mode === 'lookup-failure')
          candidateService.resolveCandidatesFromSignals.mockRejectedValue(
            new Error('credential should stay out of traces')
          );
        if (mode === 'send-failure')
          jest
            .mocked((message.channel as any).send)
            .mockRejectedValue(new Error('credential should stay out of traces'));
        if (mode === 'persistence-failure')
          jest
            .spyOn(reportIntakeRepository, 'update')
            .mockRejectedValue(new Error('credential should stay out of traces'));
        if (mode === 'no-candidates')
          await expect(agentService.runAnalysisForThreadMessage(message)).resolves.toBe(false);
        else
          await expect(agentService.runAnalysisForThreadMessage(message)).rejects.toThrow(
            'credential'
          );
        const root = recorder.spans.find((span) => span.name === 'report-intake');
        expect(root).toBeDefined();
        expect(root?.attributes['session.id']).toBe(`development:intake:${intake.id}`);
        expect(
          root?.attributes['langfuse.observation.metadata.scheduling_delay_ms']
        ).toBeUndefined();
        if (mode === 'no-candidates')
          expect(JSON.parse(String(root?.attributes['langfuse.observation.output']))).toMatchObject(
            { actual_outcome: 'no_candidates', persistence_completed: true }
          );
        else expect(root?.attributes['langfuse.observation.level']).toBe('ERROR');
        expect(JSON.stringify(recorder.spans.map((span) => span.attributes))).not.toContain(
          'credential'
        );
        expect(recorder.spans.some((span) => span.name === 'resolve-candidates')).toBe(true);
      } finally {
        await recorder.shutdown();
      }
    }
  );
  it('traces only the latest debounce run and ends after deferred persistence', async () => {
    jest.useFakeTimers();
    const { agentService, intakeService, reportIntakeRepository, gptService } = buildServices();
    const intake = await intakeService.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const message = buildMessage();
    await intakeService.handleThreadMessage(message);
    const recorder = createTracingRecorder();
    const extraction = {
      visibleNames: [],
      visibleUsernames: [],
      visibleUserIds: ['user-1'],
      visibleMessageLinks: [],
      quotedMessageText: [],
      platformHints: [],
      abuseSignals: [],
      uncertainty: [],
      confidence: 0.9,
      analyzedImageCount: 1,
      model: 'test',
      promptVersion: 'test',
      isFallback: false,
    };
    gptService.extractReportIntakeEvidence.mockImplementation(() =>
      withObservation('gpt.report-intake-extraction', 'generation', async () => extraction)
    );
    const update = reportIntakeRepository.update.bind(reportIntakeRepository);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(reportIntakeRepository, 'update').mockImplementationOnce(async (id, data) => {
      await held;
      return update(id, data);
    });
    try {
      agentService.scheduleAnalysisForThreadMessage(message);
      await jest.advanceTimersByTimeAsync(1000);
      agentService.scheduleAnalysisForThreadMessage({
        ...message,
        id: 'latest-message',
      } as Message);
      await jest.advanceTimersByTimeAsync(0);
      expect(recorder.spans).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(15000);
      expect(gptService.extractReportIntakeEvidence).toHaveBeenCalledTimes(1);
      expect(recorder.spans.some((span) => span.name === 'report-intake')).toBe(false);
      expect((message.channel as any).send).toHaveBeenCalledTimes(1);
      release();
      await jest.advanceTimersByTimeAsync(0);
      const root = recorder.spans.find((span) => span.name === 'report-intake');
      expect(root).toBeDefined();
      expect(root?.attributes['langfuse.observation.metadata.scheduling_delay_ms']).toBe('15000');
      expect(root?.attributes['langfuse.observation.metadata.scheduled_message_id']).toBe(
        'latest-message'
      );
      expect(root?.attributes['session.id']).toBe(`development:intake:${intake.id}`);
      const generation = recorder.spans.find(
        (span) => span.name === 'gpt.report-intake-extraction'
      );
      expect(generation?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
      expect(recorder.spans.filter((span) => span.name === 'persist-result')).toHaveLength(1);
    } finally {
      release();
      jest.useRealTimers();
      await recorder.shutdown();
    }
  });
  it('skips closed intakes without a trace or model call', async () => {
    const { agentService, intakeService, reportIntakeRepository, gptService } = buildServices();
    const intake = await intakeService.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await reportIntakeRepository.update(intake.id, { status: ReportIntakeStatus.SUBMITTED });
    const recorder = createTracingRecorder();
    try {
      await expect(agentService.runAnalysisForThreadMessage(buildMessage())).resolves.toBe(false);
      expect(recorder.spans).toHaveLength(0);
      expect(gptService.extractReportIntakeEvidence).not.toHaveBeenCalled();
    } finally {
      await recorder.shutdown();
    }
  });
  it('keeps two intake timers in separate traces and sessions', async () => {
    jest.useFakeTimers();
    const { agentService, reportIntakeRepository, gptService } = buildServices();
    const messages: Message[] = [];
    for (const id of ['one', 'two']) {
      const intake = await reportIntakeRepository.create({
        serverId: 'guild-1',
        reporterId: `reporter-${id}`,
        threadId: `thread-${id}`,
        status: ReportIntakeStatus.COLLECTING_EVIDENCE,
      });
      await reportIntakeRepository.addEvidence({
        intakeId: intake.id,
        kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
        content: 'Please check this target',
      });
      messages.push(
        buildMessage({
          id: `message-${id}`,
          channelId: `thread-${id}`,
          channel: {
            id: `thread-${id}`,
            isThread: () => true,
            send: jest.fn().mockResolvedValue(undefined),
          },
        })
      );
    }
    const recorder = createTracingRecorder();
    try {
      for (const message of messages) agentService.scheduleAnalysisForThreadMessage(message);
      await jest.advanceTimersByTimeAsync(15000);
      const roots = recorder.spans.filter((span) => span.name === 'report-intake');
      expect(roots).toHaveLength(2);
      expect(roots[0].spanContext().traceId).not.toBe(roots[1].spanContext().traceId);
      expect(roots[0].attributes['session.id']).not.toBe(roots[1].attributes['session.id']);
      expect(gptService.extractReportIntakeEvidence).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      await recorder.shutdown();
    }
  });
  it('suppresses repeated confirmations and never replays a send when telemetry ending fails', async () => {
    const { agentService, intakeService, reportIntakeRepository } = buildServices();
    const intake = await intakeService.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const message = buildMessage();
    await intakeService.handleThreadMessage(message);
    const recorder = createTracingRecorder();
    const push = recorder.spans.push.bind(recorder.spans);
    jest.spyOn(recorder.spans, 'push').mockImplementation((...spans) => {
      const count = push(...spans);
      if (spans.some((span) => span.name === 'send-confirmation'))
        throw new Error('telemetry end failed');
      return count;
    });
    try {
      await expect(agentService.runAnalysisForThreadMessage(message)).resolves.toBe(true);
      const firstEvidence = await reportIntakeRepository.listEvidence(intake.id);
      await reportIntakeRepository.addEvidence({
        intakeId: intake.id,
        kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
        content: 'Another detail about the same target',
      });
      await reportIntakeRepository.update(intake.id, {
        status: ReportIntakeStatus.COLLECTING_EVIDENCE,
      });
      await expect(agentService.runAnalysisForThreadMessage(message)).resolves.toBe(true);
      expect((message.channel as any).send).toHaveBeenCalledTimes(1);
      const roots = recorder.spans.filter((span) => span.name === 'report-intake');
      expect(roots).toHaveLength(2);
      expect(roots[0].attributes['session.id']).toBe(roots[1].attributes['session.id']);
      expect(roots[0].spanContext().traceId).not.toBe(roots[1].spanContext().traceId);
      expect(JSON.parse(String(roots[1].attributes['langfuse.observation.output']))).toMatchObject({
        confirmation_sent: false,
        persistence_completed: true,
      });
      expect((await reportIntakeRepository.listEvidence(intake.id)).length).toBe(
        firstEvidence.length + 1
      );
      const confirmations = recorder.spans.filter((span) => span.name === 'send-confirmation');
      expect(
        JSON.parse(String(confirmations[1].attributes['langfuse.observation.output']))
      ).toMatchObject({ confirmation_sent: false, reason: 'unchanged_candidates' });
    } finally {
      await recorder.shutdown();
    }
  });
});
