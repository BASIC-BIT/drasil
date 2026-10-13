import type { IThreadManager } from '../../services/ThreadManager';
import { GuildMember, Message, User } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import {
  InMemoryReportIntakeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';
import { ReportIntakeEvidenceKind, ReportIntakeStatus } from '../../repositories/types';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
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

const buildPrompt = (id = 'prompt-1') => ({ id, edit: jest.fn().mockResolvedValue(undefined) });

const buildMessage = (overrides: Record<string, unknown> = {}): Message =>
  ({
    id: 'message-1',
    content: 'I want to report this message link',
    channelId: 'thread-1',
    guild: { id: 'guild-1' },
    channel: {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(buildPrompt()),
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
    const moderationQueueService = {
      recordReportThreadAttention: jest.fn().mockResolvedValue(undefined),
      deleteReportThreadAttention: jest.fn().mockResolvedValue(undefined),
    } as unknown as IModerationQueueService;
    const threadManager = {
      retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined),
    } as unknown as IThreadManager;
    const service = new ReportIntakeService(
      reportIntakeRepository,
      serverRepository,
      userRepository,
      serverMemberRepository,
      configService,
      candidateService,
      threadManager,
      moderationQueueService
    );

    return {
      service,
      reportIntakeRepository,
      candidateService,
      moderationQueueService,
      threadManager,
    };
  }

  async function preparePrompt() {
    const setup = buildService();
    const intake = await setup.service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const prompt = buildPrompt();
    const send = jest.fn().mockResolvedValue(prompt);
    const message = buildMessage({ channel: { id: 'thread-1', isThread: () => true, send } });
    return { ...setup, intake, prompt, send, message };
  }

  it('unpublished prompt keeps disabled controls until persistence succeeds', async () => {
    const { service, reportIntakeRepository, intake, prompt, send, message } =
      await preparePrompt();
    prompt.edit.mockImplementationOnce(async () => {
      expect((await reportIntakeRepository.findById(intake.id))?.metadata).toMatchObject({
        last_confirmation_prompt_message_id: prompt.id,
      });
    });
    await service.handleThreadMessage(message);
    const rows = send.mock.calls[0][0].components;
    expect(
      rows
        .flatMap((row: { components: { data: { disabled: boolean } }[] }) => row.components)
        .every((button: { data: { disabled: boolean } }) => button.data.disabled)
    ).toBe(true);
    expect(prompt.edit).toHaveBeenCalledWith({ components: expect.any(Array) });
    expect(
      prompt.edit.mock.calls[0][0].components
        .flatMap((row: { components: { data: { disabled: boolean } }[] }) => row.components)
        .every((button: { data: { disabled: boolean } }) => button.data.disabled === false)
    ).toBe(true);
    expect((await reportIntakeRepository.findById(intake.id))?.metadata).toMatchObject({
      confirmation_prompt_message_ids: [prompt.id],
    });
  });

  it('lost publication write leaves the new prompt disabled', async () => {
    const { service, reportIntakeRepository, prompt, message } = await preparePrompt();
    jest.spyOn(reportIntakeRepository, 'updateIfCurrent').mockResolvedValue(null);
    await service.handleThreadMessage(message);
    expect(prompt.edit).toHaveBeenCalledWith({ components: [] });
    expect(prompt.edit).not.toHaveBeenCalledWith({
      components: expect.arrayContaining([expect.anything()]),
    });
  });

  it('exhausted pending collisions keep evidence and ask for moderator review', async () => {
    const { service, reportIntakeRepository, intake, message, send, candidateService } =
      await preparePrompt();
    jest.spyOn(reportIntakeRepository, 'updateIfCurrent').mockResolvedValue(null);
    await service.handleThreadMessage(message);
    expect(send).toHaveBeenLastCalledWith({
      content:
        "Drasil couldn't prepare the confirmation buttons. Please ask a moderator to review this thread.",
      components: [],
      allowedMentions: { parse: [] },
    });
    expect((await reportIntakeRepository.listEvidence(intake.id)).length).toBeGreaterThan(0);
    expect(candidateService.resolvePlatformBackedCandidates).toHaveBeenCalledTimes(1);
    expect(reportIntakeRepository.updateIfCurrent).toHaveBeenCalledTimes(2);
  });

  it('a selection winning the last pending collision suppresses the unavailable-prompt warning', async () => {
    const { service, reportIntakeRepository, intake, message, send } = await preparePrompt();
    jest
      .spyOn(reportIntakeRepository, 'updateIfCurrent')
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => {
        await reportIntakeRepository.update(intake.id, {
          status: ReportIntakeStatus.SUBMITTED,
          confirmedTargetUserId: 'user-1',
        });
        return null;
      });
    await service.handleThreadMessage(message);
    expect(send.mock.calls.some(([payload]) => payload.content.includes("couldn't prepare"))).toBe(
      false
    );
    expect((await reportIntakeRepository.findById(intake.id))?.status).toBe(
      ReportIntakeStatus.SUBMITTED
    );
  });

  it('a retry does not reintroduce a candidate rejected by the newer snapshot', async () => {
    const { service, reportIntakeRepository, intake, message, send } = await preparePrompt();
    const update = reportIntakeRepository.updateIfCurrent.bind(reportIntakeRepository);
    jest
      .spyOn(reportIntakeRepository, 'updateIfCurrent')
      .mockImplementationOnce(async (snapshot, data) => {
        await reportIntakeRepository.update(intake.id, {
          metadata: { rejected_candidate_ids: ['user-1'] },
        });
        return update(snapshot, data);
      });
    await service.handleThreadMessage(message);
    expect((await reportIntakeRepository.findById(intake.id))?.metadata).toMatchObject({
      rejected_candidate_ids: ['user-1'],
      candidate_suggestions: [],
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('enable failure preserves evidence and asks for moderator review', async () => {
    const { service, reportIntakeRepository, intake, prompt, send, message } =
      await preparePrompt();
    prompt.edit.mockRejectedValueOnce(new Error('Discord denied edit'));
    await service.handleThreadMessage(message);
    expect((await reportIntakeRepository.listEvidence(intake.id)).length).toBeGreaterThan(0);
    expect((await reportIntakeRepository.findById(intake.id))?.metadata).toMatchObject({
      last_confirmation_prompt_message_id: prompt.id,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "Drasil couldn't enable the confirmation buttons. Please ask a moderator to review this thread.",
      })
    );
  });

  it('closeout overlapping enable cannot leave active confirmation controls', async () => {
    const { service, reportIntakeRepository, intake, prompt, message } = await preparePrompt();
    prompt.edit.mockImplementationOnce(async () => {
      await service.closeIntakeForThread({ threadId: 'thread-1', closedById: 'reporter-1' });
    });
    await service.handleThreadMessage(message);
    expect((await reportIntakeRepository.findById(intake.id))?.status).toBe(
      ReportIntakeStatus.CLOSED_BY_REPORTER
    );
    expect(prompt.edit).toHaveBeenLastCalledWith({ components: [] });
  });

  it('replacement retires earlier tracked prompts', async () => {
    const { service, candidateService, intake, threadManager, send, message } =
      await preparePrompt();
    await service.handleThreadMessage(message);
    (candidateService.resolvePlatformBackedCandidates as jest.Mock).mockResolvedValueOnce([
      buildCandidate('user-2'),
    ]);
    send.mockResolvedValueOnce(buildPrompt('prompt-2'));
    await service.handleThreadMessage(message);
    expect(threadManager.retireReportConfirmationPrompts).toHaveBeenCalledWith(
      expect.objectContaining({ id: intake.id }),
      ['prompt-1']
    );
  });

  it.each(['confirm', 'reject'])(
    'retires confirmation controls after %s and preserves outcome when cleanup fails',
    async (action) => {
      const { service, intake, reportIntakeRepository, threadManager, message } =
        await preparePrompt();
      await service.handleThreadMessage(message);
      (threadManager.retireReportConfirmationPrompts as jest.Mock).mockRejectedValueOnce(
        new Error('cleanup denied')
      );
      const metadata = (await reportIntakeRepository.findById(intake.id))?.metadata;
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        throw new Error('Missing prompt metadata');
      const token = metadata.last_confirmation_prompt_token;
      const result =
        action === 'confirm'
          ? await service.confirmCandidate({
              intakeId: intake.id,
              targetUserId: 'user-1',
              confirmedById: 'reporter-1',
              promptMessageId: 'prompt-1',
            })
          : await service.rejectCandidates({
              intakeId: intake.id,
              promptToken: String(token),
              rejectedById: 'reporter-1',
              promptMessageId: 'prompt-1',
            });
      expect(result).toMatchObject(action === 'confirm' ? { confirmed: true } : { rejected: true });
      expect(threadManager.retireReportConfirmationPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ id: intake.id }),
        ['prompt-1']
      );
    }
  );

  it('a moderator note cannot discard a reporter candidate resolved concurrently', async () => {
    let releaseReporter!: () => void;
    let reporterReached!: () => void;
    const reporterCandidates = new Promise<ReportCandidate[]>((resolve) => {
      releaseReporter = () => resolve([buildCandidate()]);
    });
    const reporterStarted = new Promise<void>((resolve) => {
      reporterReached = resolve;
    });
    const { service, reportIntakeRepository } = buildService({
      resolvePlatformBackedCandidates: jest.fn(async () => {
        reporterReached();
        return reporterCandidates;
      }),
    });
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const prompts = [buildPrompt('losing-prompt'), buildPrompt('current-prompt')];
    const send = jest.fn().mockResolvedValueOnce(prompts[0]).mockResolvedValueOnce(prompts[1]);
    const channel = { id: 'thread-1', isThread: () => true, send };
    const reporting = service.handleThreadMessage(
      buildMessage({ id: 'reporter-message', channel })
    );
    await reporterStarted;
    await service.handleThreadMessage(
      buildMessage({
        id: 'staff-message',
        author: { id: 'staff-1', bot: false },
        content: 'Moderator note',
        channel,
      })
    );
    releaseReporter();
    await reporting;
    expect(await reportIntakeRepository.findById(intake.id)).toMatchObject({
      status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
      metadata: {
        candidate_suggestions: [expect.objectContaining({ discordUserId: 'user-1' })],
        last_confirmation_prompt_message_id: 'current-prompt',
      },
    });
    expect(prompts[0].edit).toHaveBeenCalledWith({ components: [] });
    expect(prompts[1].edit).toHaveBeenCalledWith({ components: expect.any(Array) });
    expect(
      (await reportIntakeRepository.listEvidence(intake.id)).some(
        (entry) => entry.content === 'Moderator note'
      )
    ).toBe(true);
  });

  it('a retried prompt includes candidates from both overlapping reporter messages', async () => {
    const { service, reportIntakeRepository, candidateService } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    (candidateService.resolvePlatformBackedCandidates as jest.Mock).mockImplementationOnce(
      async () => {
        await reportIntakeRepository.update(intake.id, {
          status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
          metadata: {
            candidate_suggestions: [buildCandidate('user-2')],
            preserved_note: 'newer',
            confirmation_prompt_message_ids: ['prior-prompt'],
          },
        });
        return [buildCandidate('user-1')];
      }
    );
    const prompt = buildPrompt('retry-prompt');
    const send = jest
      .fn()
      .mockResolvedValueOnce(buildPrompt('lost-prompt'))
      .mockResolvedValueOnce(prompt);
    await service.handleThreadMessage(
      buildMessage({ channel: { id: 'thread-1', isThread: () => true, send } })
    );
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringContaining('User ID: `user-1`') })
    );
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringContaining('User ID: `user-2`') })
    );
    expect((await reportIntakeRepository.findById(intake.id))?.metadata).toMatchObject({
      preserved_note: 'newer',
      candidate_suggestions: expect.arrayContaining([
        expect.objectContaining({ discordUserId: 'user-1' }),
        expect.objectContaining({ discordUserId: 'user-2' }),
      ]),
    });
    expect(prompt.edit).toHaveBeenCalledWith({ components: expect.any(Array) });
  });

  it('analysis publication retries a pending metadata collision without losing fresh fields', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const update = reportIntakeRepository.updateIfCurrent.bind(reportIntakeRepository);
    jest
      .spyOn(reportIntakeRepository, 'updateIfCurrent')
      .mockImplementationOnce(async (snapshot, data) => {
        await reportIntakeRepository.update(intake.id, { metadata: { staff_note: 'newer' } });
        return update(snapshot, data);
      });
    const result = await service.recordAgentAnalysis({
      intakeId: intake.id,
      message: buildMessage(),
      candidates: [buildCandidate()],
      evidenceCount: 1,
      imageCount: 0,
    });
    expect(result).toBe(true);
    expect((await reportIntakeRepository.findById(intake.id))?.metadata).toMatchObject({
      staff_note: 'newer',
      candidate_suggestions: [expect.objectContaining({ discordUserId: 'user-1' })],
    });
  });

  it('an older analysis retry preserves a newer assessment and merges both candidate sets', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const extraction = {
      visibleNames: [],
      visibleUsernames: [],
      visibleUserIds: [],
      visibleMessageLinks: [],
      quotedMessageText: [],
      platformHints: [],
      abuseSignals: ['older assessment'],
      uncertainty: [],
      confidence: 0.7,
      analyzedImageCount: 1,
      model: 'old-model',
      promptVersion: 'test-prompt',
      isFallback: false,
    };
    let releaseOld!: () => void;
    let oldReached!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      oldReached = resolve;
    });
    const update = reportIntakeRepository.updateIfCurrent.bind(reportIntakeRepository);
    jest
      .spyOn(reportIntakeRepository, 'updateIfCurrent')
      .mockImplementationOnce(async (snapshot, data) => {
        oldReached();
        await held;
        return update(snapshot, data);
      });
    const send = jest
      .fn()
      .mockResolvedValueOnce(buildPrompt('old-prompt'))
      .mockResolvedValueOnce(buildPrompt('new-prompt'))
      .mockResolvedValueOnce(buildPrompt('merged-prompt'));
    const message = buildMessage({ channel: { id: 'thread-1', isThread: () => true, send } });
    const older = service.recordAgentAnalysis({
      intakeId: intake.id,
      message,
      candidates: [buildCandidate('user-1')],
      extraction,
      evidenceCount: 1,
      imageCount: 1,
    });
    await reached;
    await service.recordAgentAnalysis({
      intakeId: intake.id,
      message,
      candidates: [buildCandidate('user-2')],
      extraction: {
        ...extraction,
        abuseSignals: ['newer assessment with more evidence'],
        model: 'new-model',
        analyzedImageCount: 2,
      },
      evidenceCount: 2,
      imageCount: 2,
    });
    const newerMetadata = (await reportIntakeRepository.findById(intake.id))?.metadata as Record<
      string,
      unknown
    >;
    releaseOld();
    await older;
    const stored = await reportIntakeRepository.findById(intake.id);
    expect(stored?.summary).toBe('newer assessment with more evidence');
    expect(stored?.metadata).toMatchObject({
      report_intake_agent: newerMetadata.report_intake_agent,
      candidate_suggestions: expect.arrayContaining([
        expect.objectContaining({ discordUserId: 'user-1' }),
        expect.objectContaining({ discordUserId: 'user-2' }),
      ]),
    });
  });

  it('analysis retry computes status from the current pending snapshot', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const update = reportIntakeRepository.updateIfCurrent.bind(reportIntakeRepository);
    jest
      .spyOn(reportIntakeRepository, 'updateIfCurrent')
      .mockImplementationOnce(async (snapshot, data) => {
        await reportIntakeRepository.update(intake.id, {
          status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
        });
        return update(snapshot, data);
      });
    await service.recordAgentAnalysis({
      intakeId: intake.id,
      message: buildMessage(),
      candidates: [],
      evidenceCount: 0,
      imageCount: 0,
    });
    expect((await reportIntakeRepository.findById(intake.id))?.status).toBe(
      ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION
    );
  });

  it.each(['reporter-1', 'staff-1'])(
    'saved rejection by %s remains successful when auxiliary evidence logging fails',
    async (actor) => {
      const { service, reportIntakeRepository, intake, message } = await preparePrompt();
      await service.handleThreadMessage(message);
      const metadata = (await reportIntakeRepository.findById(intake.id))?.metadata as Record<
        string,
        unknown
      >;
      jest
        .spyOn(reportIntakeRepository, 'addEvidence')
        .mockRejectedValueOnce(new Error('evidence insert failed'));
      await expect(
        service.rejectCandidates({
          intakeId: intake.id,
          rejectedById: actor,
          rejectedByStaff: actor !== 'reporter-1',
          promptToken: String(metadata.last_confirmation_prompt_token),
          promptMessageId: 'prompt-1',
        })
      ).resolves.toEqual({ rejected: true, message: 'Selection cleared.' });
      expect(await reportIntakeRepository.findById(intake.id)).toMatchObject({
        status: ReportIntakeStatus.COLLECTING_EVIDENCE,
        metadata: {
          candidate_suggestions: [],
          rejected_candidate_ids: ['user-1'],
          last_rejected_by: actor,
        },
      });
    }
  );

  it.each(['confirm', 'reject'])(
    'a pending moderator confirmation is not called closed by %s',
    async (action) => {
      const { service, reportIntakeRepository } = buildService();
      const intake = await service.openIntakeFromThread({
        serverId: 'guild-1',
        reporter: buildReporter(),
        threadId: 'thread-1',
        channelId: 'channel-1',
      });
      await reportIntakeRepository.update(intake.id, {
        status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
      });
      const update = jest.spyOn(reportIntakeRepository, 'updateIfCurrent');
      const result =
        action === 'confirm'
          ? await service.confirmCandidate({
              intakeId: intake.id,
              targetUserId: 'user-1',
              confirmedById: 'reporter-1',
            })
          : await service.rejectCandidates({
              intakeId: intake.id,
              promptToken: 'old-token',
              rejectedById: 'reporter-1',
            });
      expect(result.message).toBe('This report is waiting for a moderator.');
      expect(update).not.toHaveBeenCalled();
      expect((await reportIntakeRepository.findById(intake.id))?.status).toBe(
        ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION
      );
    }
  );

  it('an older tracked prompt cannot select a still-suggested candidate', async () => {
    const { service, intake, message } = await preparePrompt();
    await service.handleThreadMessage(message);
    expect(
      await service.confirmCandidate({
        intakeId: intake.id,
        targetUserId: 'user-1',
        confirmedById: 'reporter-1',
        promptMessageId: 'older-prompt',
      })
    ).toMatchObject({
      confirmed: false,
      message: 'Use the latest confirmation message in this thread.',
    });
  });

  it('publication persistence exception retires the disabled new prompt', async () => {
    const { service, reportIntakeRepository, intake, prompt, message } = await preparePrompt();
    jest
      .spyOn(reportIntakeRepository, 'updateIfCurrent')
      .mockRejectedValueOnce(new Error('database failed'));
    await expect(
      service.recordAgentAnalysis({
        intakeId: intake.id,
        message,
        candidates: [buildCandidate()],
        evidenceCount: 1,
        imageCount: 0,
      })
    ).rejects.toThrow('database failed');
    expect(prompt.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('keeps legacy candidates without tracked prompt IDs usable', async () => {
    const { service, reportIntakeRepository, intake, message } = await preparePrompt();
    await service.handleThreadMessage(message);
    const metadata = (await reportIntakeRepository.findById(intake.id))?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      throw new Error('Missing fixture metadata');
    const legacy = { ...metadata };
    delete legacy.confirmation_prompt_message_ids;
    delete legacy.last_confirmation_prompt_message_id;
    await reportIntakeRepository.update(intake.id, { metadata: legacy });
    expect(
      await service.confirmCandidate({
        intakeId: intake.id,
        targetUserId: 'user-1',
        confirmedById: 'reporter-1',
      })
    ).toMatchObject({ confirmed: true });
  });

  it.each([true, false])(
    'preserves safe identity formatting with username available: %s',
    async (hasUsername) => {
      const { service } = buildService({
        resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([
          {
            ...buildCandidate(),
            username: hasUsername ? 'user`name' : null,
            displayName: 'Display`name',
          },
        ]),
      });
      await service.openIntakeFromThread({
        serverId: 'guild-1',
        reporter: buildReporter(),
        threadId: 'thread-1',
        channelId: 'channel-1',
      });
      const send = jest.fn().mockResolvedValue(buildPrompt());
      await service.handleThreadMessage(
        buildMessage({ channel: { id: 'thread-1', isThread: () => true, send } })
      );
      expect(send.mock.calls[0][0].content).toContain("`Display'name`");
      if (hasUsername) expect(send.mock.calls[0][0].content).toContain("@`user'name`");
      expect(send.mock.calls[0][0].content).toContain('User ID: `user-1`');
      expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
    }
  );

  it('missing intake does not establish submission persistence', async () => {
    const { service, reportIntakeRepository } = buildService();
    const update = jest.spyOn(reportIntakeRepository, 'updateIfCurrent');
    expect(
      await service.markSubmitted({
        intakeId: 'missing',
        targetUserId: 'user-1',
        submittedById: 'reporter-1',
      })
    ).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('exhausted null state writes retain the reservation and block duplicate submission', async () => {
    const { service, reportIntakeRepository, intake, message } = await preparePrompt();
    await service.handleThreadMessage(message);
    await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
      promptMessageId: 'prompt-1',
    });
    const update = jest.spyOn(reportIntakeRepository, 'updateIfCurrent').mockResolvedValue(null);
    expect(
      await service.markSubmitted({
        intakeId: intake.id,
        targetUserId: 'user-1',
        submittedById: 'reporter-1',
      })
    ).toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
    expect(
      await service.confirmCandidate({
        intakeId: intake.id,
        targetUserId: 'user-1',
        confirmedById: 'reporter-1',
        promptMessageId: 'prompt-1',
      })
    ).toMatchObject({
      confirmed: false,
      message:
        'A person is already selected. Submission is not confirmed. No second report was submitted.',
    });
    expect((await reportIntakeRepository.findById(intake.id))?.confirmed_target_user_id).toBe(
      'user-1'
    );
  });

  it('numbers duplicate long-name matches and excludes the reporter from the match count', async () => {
    const candidates = [
      buildCandidate('reporter-1'),
      ...Array.from({ length: 6 }, (_, index) => ({
        ...buildCandidate(`user-${index + 1}`),
        displayName: 'Same name'.repeat(12),
      })),
    ];
    const { service } = buildService({
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue(candidates),
    });
    await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const send = jest.fn().mockResolvedValue(buildPrompt());
    const message = buildMessage({
      channel: { id: 'thread-1', isThread: jest.fn().mockReturnValue(true), send },
    });
    await service.handleThreadMessage(message);
    const payload = send.mock.calls[0][0];
    expect(payload.content).toContain('Who do you want to report?');
    expect(payload.content).toContain('Showing 5 of 6 matches.');
    expect(
      payload.components[0].components.map(
        (button: { data: { label: string } }) => button.data.label
      )
    ).toEqual(['Report 1', 'Report 2', 'Report 3', 'Report 4', 'Report 5']);
    expect(payload.components[1].components[0].data.label).toBe('None of these');
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it.each([
    ReportIntakeStatus.ACTIONED,
    ReportIntakeStatus.DISMISSED,
    ReportIntakeStatus.FALSE_POSITIVE,
    ReportIntakeStatus.CLOSED_BY_REPORTER,
    ReportIntakeStatus.EXPIRED,
  ])('describes %s as closed rather than submitted', async (status) => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await reportIntakeRepository.update(intake.id, { status });
    expect(
      await service.confirmCandidate({
        intakeId: intake.id,
        targetUserId: 'user-1',
        promptMessageId: 'prompt-1',
        confirmedById: 'reporter-1',
      })
    ).toEqual({ confirmed: false, message: 'This report is closed.' });
  });

  it('confirmation prevents a concurrent rejection', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());
    const current = await reportIntakeRepository.findById(intake.id);
    const token = (current?.metadata as { last_confirmation_prompt_token: string })
      .last_confirmation_prompt_token;
    await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      promptMessageId: 'prompt-1',
      confirmedById: 'reporter-1',
    });
    const result = await service.rejectCandidates({
      intakeId: intake.id,
      promptToken: token,
      promptMessageId: 'prompt-1',
      rejectedById: 'reporter-1',
    });
    expect(result.rejected).toBe(false);
    expect(result.message).toBe(
      'A person is already selected. Submission is not confirmed. No second report was submitted.'
    );
    expect((await reportIntakeRepository.findById(intake.id))?.confirmed_target_user_id).toBe(
      'user-1'
    );
    expect((await reportIntakeRepository.findById(intake.id))?.status).toBe(
      ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
    );
  });

  it.each([
    ReportIntakeStatus.ACTIONED,
    ReportIntakeStatus.DISMISSED,
    ReportIntakeStatus.FALSE_POSITIVE,
    ReportIntakeStatus.CLOSED_BY_REPORTER,
    ReportIntakeStatus.EXPIRED,
  ])('late submission preserves %s and its closed timestamp', async (status) => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const closedAt = new Date('2026-01-01T00:00:00Z');
    await reportIntakeRepository.update(intake.id, {
      status,
      closedAt,
      confirmedTargetUserId: 'user-1',
      metadata: { reviewed_by: 'staff-1' },
    });
    await service.markSubmitted({
      intakeId: intake.id,
      targetUserId: 'user-1',
      submittedById: 'reporter-1',
    });
    expect(await reportIntakeRepository.findById(intake.id)).toMatchObject({
      status,
      closed_at: closedAt,
      metadata: { reviewed_by: 'staff-1', submitted_by: 'reporter-1' },
    });
  });

  it('submission and thread close retain each other metadata', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    const find = reportIntakeRepository.findById.bind(reportIntakeRepository);
    jest.spyOn(reportIntakeRepository, 'findById').mockImplementationOnce(async (id) => {
      const snapshot = await find(id);
      await reportIntakeRepository.update(id, { metadata: { thread_closed_by: 'staff-1' } });
      return snapshot;
    });
    await service.markSubmitted({
      intakeId: intake.id,
      targetUserId: 'user-1',
      submittedById: 'reporter-1',
    });
    expect((await find(intake.id))?.metadata).toMatchObject({
      thread_closed_by: 'staff-1',
      submitted_by: 'reporter-1',
    });
  });

  it('closing a selected report preserves its reservation without claiming cancellation', async () => {
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
      promptMessageId: 'prompt-1',
      confirmedById: 'reporter-1',
    });
    const result = await service.closeIntakeForThread({
      threadId: 'thread-1',
      closedById: 'reporter-1',
    });
    expect(result.message).toBe('The selected person remains recorded for moderator review.');
    expect((await reportIntakeRepository.findById(intake.id))?.status).toBe(
      ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
    );
    expect((await reportIntakeRepository.findById(intake.id))?.confirmed_target_user_id).toBe(
      'user-1'
    );
  });

  it.each([ReportIntakeStatus.SUBMITTED, ReportIntakeStatus.CLOSED_BY_REPORTER])(
    'slow evidence analysis cannot reopen a %s intake',
    async (status) => {
      const { service, reportIntakeRepository, candidateService } = buildService();
      const intake = await service.openIntakeFromThread({
        serverId: 'guild-1',
        reporter: buildReporter(),
        threadId: 'thread-1',
        channelId: 'channel-1',
      });
      (candidateService.resolvePlatformBackedCandidates as jest.Mock).mockImplementationOnce(
        async () => {
          await reportIntakeRepository.update(intake.id, {
            status,
            confirmedTargetUserId: 'user-1',
            metadata: { submitted_by: 'reporter-1' },
          });
          return [buildCandidate()];
        }
      );
      await service.handleThreadMessage(buildMessage());
      expect(await reportIntakeRepository.findById(intake.id)).toMatchObject({
        status,
        metadata: { submitted_by: 'reporter-1' },
      });
    }
  );

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
        content: expect.stringContaining('Report this person?'),
        allowedMentions: { parse: [] },
      })
    );
    expect((message.channel as any).send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('`Target user-1` (@`target-user-1`)\nUser ID: `user-1`'),
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
      promptMessageId: 'prompt-1',
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
      promptMessageId: 'prompt-1',
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

  it('rejects staff confirming themselves as the report target', async () => {
    const { service } = buildService({
      resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([buildCandidate('staff-1')]),
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
      targetUserId: 'staff-1',
      promptMessageId: 'prompt-1',
      confirmedById: 'staff-1',
      confirmedByStaff: true,
    });

    expect(result).toMatchObject({
      confirmed: false,
      message: 'You cannot report yourself.',
    });
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
      promptMessageId: 'prompt-1',
      confirmedById: 'user-2',
    });

    expect(result).toMatchObject({
      confirmed: false,
      message: 'Only the reporter or a moderator can confirm the person.',
    });
  });

  it('rejects duplicate confirmations after submission', async () => {
    const { service, reportIntakeRepository, moderationQueueService } = buildService();
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
      promptMessageId: 'prompt-1',
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
      promptMessageId: 'prompt-1',
      confirmedById: 'reporter-1',
    });
    const confirmationEvidence = (await reportIntakeRepository.listEvidence(intake.id)).filter(
      (item) => item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    expect(result).toMatchObject({
      confirmed: false,
      message: 'This report has already been submitted.',
    });
    expect(confirmationEvidence).toHaveLength(1);
    expect((await reportIntakeRepository.findById(intake.id))?.closed_at).toBeInstanceOf(Date);
    expect(moderationQueueService.deleteReportThreadAttention).toHaveBeenCalledWith(intake.id);
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
      promptMessageId: 'prompt-1',
      confirmedById: 'reporter-1',
    });

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      promptMessageId: 'prompt-1',
      confirmedById: 'reporter-1',
    });
    const confirmationEvidence = (await reportIntakeRepository.listEvidence(intake.id)).filter(
      (item) => item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    expect(result).toMatchObject({
      confirmed: false,
      message:
        'A person is already selected. Submission is not confirmed. No second report was submitted.',
    });
    expect(result).not.toHaveProperty('reason');
    expect(confirmationEvidence).toHaveLength(1);
  });

  it('does not submit when another confirmation wins the conditional update', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.handleThreadMessage(buildMessage());
    const reserve = reportIntakeRepository.confirmTargetIfUnset.bind(reportIntakeRepository);
    jest
      .spyOn(reportIntakeRepository, 'confirmTargetIfUnset')
      .mockImplementationOnce(async (id, data) => {
        await reserve(id, data);
        return null;
      });

    const result = await service.confirmCandidate({
      intakeId: intake.id,
      targetUserId: 'user-1',
      promptMessageId: 'prompt-1',
      confirmedById: 'reporter-1',
    });
    const confirmationEvidence = (await reportIntakeRepository.listEvidence(intake.id)).filter(
      (item) => item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION
    );

    expect(result).toMatchObject({
      confirmed: false,
      message:
        'A person is already selected. Submission is not confirmed. No second report was submitted.',
    });
    expect(result).not.toHaveProperty('reason');
    expect(confirmationEvidence).toHaveLength(0);
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
      promptMessageId: 'prompt-1',
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
      send: jest.fn().mockResolvedValue(buildPrompt()),
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
      extraction: {
        visibleNames: [],
        visibleUsernames: [],
        visibleUserIds: [],
        visibleMessageLinks: [],
        quotedMessageText: [],
        platformHints: [],
        abuseSignals: ['Possible impersonation attempt'],
        uncertainty: [],
        confidence: 0.7,
        analyzedImageCount: 1,
        model: 'test-model',
        promptVersion: 'test-prompt',
        isFallback: false,
      },
      evidenceCount: 3,
      imageCount: 1,
    });
    const afterAnalysis = await reportIntakeRepository.findById(intake.id);
    expect(analysisPrompted).toBe(false);
    expect(afterAnalysis?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(afterAnalysis?.summary).toBe('Possible impersonation attempt');
    expect(afterAnalysis?.metadata).toMatchObject({
      candidate_suggestions: [],
      summary_source: 'ai_report_intake_extraction',
    });
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
      promptMessageId: 'prompt-1',
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
      promptMessageId: 'prompt-1',
      rejectedById: 'reporter-1',
      promptToken: firstPromptToken,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(result).toMatchObject({
      rejected: false,
      message: 'Use the latest confirmation message in this thread.',
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
    const { service, reportIntakeRepository, moderationQueueService } = buildService();
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
    expect(moderationQueueService.deleteReportThreadAttention).toHaveBeenCalledWith(intake.id);
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
      promptMessageId: 'prompt-1',
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
      promptMessageId: 'prompt-1',
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
      send: jest.fn().mockResolvedValue(buildPrompt()),
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
      send: jest.fn().mockResolvedValue(buildPrompt()),
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
        content: expect.stringContaining('User ID: `user-1`'),
      })
    );
    expect(channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('User ID: `user-2`'),
      })
    );
  });

  it('lets the reporter close the intake without deleting evidence', async () => {
    const { service, reportIntakeRepository, moderationQueueService } = buildService({
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
      send: jest.fn().mockResolvedValue(buildPrompt()),
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
      content: 'Report cancelled. No report was submitted.',
      components: [],
      allowedMentions: { parse: [] },
    });
    expect(channel.setArchived).toHaveBeenCalledWith(true, 'Report intake closed');
    expect(moderationQueueService.recordReportThreadAttention).not.toHaveBeenCalled();
    expect(moderationQueueService.deleteReportThreadAttention).toHaveBeenCalledWith(intake.id);
  });

  it.each([false, true])(
    'archives text cancellation despite receipt failure, with selected target %s',
    async (selected) => {
      const { service, reportIntakeRepository, threadManager } = buildService({
        resolvePlatformBackedCandidates: jest.fn().mockResolvedValue([]),
      });
      const intake = await service.openIntakeFromThread({
        serverId: 'guild-1',
        reporter: buildReporter(),
        threadId: 'thread-1',
        channelId: 'channel-1',
      });
      await reportIntakeRepository.update(intake.id, {
        status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
        confirmedTargetUserId: selected ? 'user-1' : null,
        metadata: { confirmation_prompt_message_ids: ['prompt-1'] },
      });
      const channel = {
        id: 'thread-1',
        isThread: jest.fn().mockReturnValue(true),
        send: jest.fn().mockRejectedValue(new Error('receipt denied')),
        archived: false,
        setArchived: jest.fn().mockResolvedValue(undefined),
      };

      await service.handleThreadMessage(buildMessage({ content: 'close report', channel }));

      const stored = await reportIntakeRepository.findById(intake.id);
      expect(stored?.status).toBe(
        selected
          ? ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
          : ReportIntakeStatus.CLOSED_BY_REPORTER
      );
      expect(stored?.confirmed_target_user_id).toBe(selected ? 'user-1' : null);
      expect(stored?.closed_at).toBeInstanceOf(Date);
      expect(threadManager.retireReportConfirmationPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ id: intake.id }),
        ['prompt-1']
      );
      expect(channel.setArchived).toHaveBeenCalledWith(true, 'Report intake closed');
    }
  );

  it('refuses to close an intake thread for a user who is neither the reporter nor staff', async () => {
    const { service, reportIntakeRepository, moderationQueueService } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    const result = await service.closeIntakeForThread({
      threadId: 'thread-1',
      closedById: 'bystander-1',
      closedByStaff: false,
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(result).toEqual({
      closed: false,
      message: 'Only the reporter or a moderator can close this report.',
    });
    expect(stored?.status).toBe(ReportIntakeStatus.COLLECTING_EVIDENCE);
    expect(stored?.closed_at).toBeNull();
    expect(moderationQueueService.deleteReportThreadAttention).not.toHaveBeenCalled();
  });

  it('treats a repeated close of the same intake thread as a no-op', async () => {
    const { service, reportIntakeRepository } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });

    const first = await service.closeIntakeForThread({
      threadId: 'thread-1',
      closedById: 'reporter-1',
    });
    const firstStored = await reportIntakeRepository.findById(intake.id);
    const second = await service.closeIntakeForThread({
      threadId: 'thread-1',
      closedById: 'reporter-1',
    });
    const secondStored = await reportIntakeRepository.findById(intake.id);

    expect(first.closed).toBe(true);
    expect(second).toEqual({
      closed: true,
      message: 'This report is closed.',
      shouldArchiveThread: true,
    });
    expect(secondStored?.status).toBe(ReportIntakeStatus.CLOSED_BY_REPORTER);
    expect(secondStored?.closed_at).toEqual(firstStored?.closed_at);
  });

  it('closes the current intake thread from the close button for reporter or staff', async () => {
    const { service, reportIntakeRepository, moderationQueueService } = buildService();
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
      message: 'Report cancelled. No report was submitted.',
      shouldArchiveThread: true,
    });
    expect(stored?.status).toBe(ReportIntakeStatus.CLOSED_BY_REPORTER);
    expect(stored?.metadata).toMatchObject({
      closed_by: 'staff-1',
      closed_reason: 'staff_request',
      closed_by_staff: true,
    });
    expect(moderationQueueService.deleteReportThreadAttention).toHaveBeenCalledWith(intake.id);
  });

  it('archives submitted intake threads from the close button with closeout copy', async () => {
    const { service, reportIntakeRepository, moderationQueueService } = buildService();
    const intake = await service.openIntakeFromThread({
      serverId: 'guild-1',
      reporter: buildReporter(),
      threadId: 'thread-1',
      channelId: 'channel-1',
    });
    await service.markSubmitted({
      intakeId: intake.id,
      targetUserId: 'user-1',
      submittedById: 'reporter-1',
    });

    const result = await service.closeIntakeForThread({
      threadId: 'thread-1',
      closedById: 'reporter-1',
    });

    const stored = await reportIntakeRepository.findById(intake.id);
    expect(result).toEqual({
      closed: true,
      message: 'Report submitted.',
      shouldArchiveThread: true,
    });
    expect(stored?.status).toBe(ReportIntakeStatus.SUBMITTED);
    expect(stored?.metadata).toMatchObject({
      thread_closed_by: 'reporter-1',
      thread_closed_reason: 'submitted_thread_close',
    });
    expect(moderationQueueService.deleteReportThreadAttention).toHaveBeenCalledWith(intake.id);
  });
});
