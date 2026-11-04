import 'reflect-metadata';
import { Client, Collection, GuildMember, Message } from 'discord.js';
import OpenAI from 'openai';
import {
  createAttentionActions,
  createReportActions,
  projectReportIntakeState,
  type ReportEvidenceRef,
  type ReportSubjectClues,
} from '@drasil/application';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { ModerationQueueRepository } from '../../repositories/ModerationQueueRepository';
import { ModerationQueueItemType } from '../../repositories/types';
import { processingMetadata } from '../../repositories/reportIntakeProcessing';
import { ReportIntakeService } from '../../services/ReportIntakeService';
import { ReportIntakeAgentService } from '../../services/ReportIntakeAgentService';
import { ReportIntakeAnalysisWorker } from '../../services/ReportIntakeAnalysisWorker';
import {
  ReportIntakeHandoffService,
  REPORT_HANDOFF_RECEIPT,
} from '../../services/ReportIntakeHandoffService';
import { ReportCandidateService } from '../../services/ReportCandidateService';
import { reportDirectoryMember } from '../../services/ReportMemberDirectory';
import { GPTService } from '../../services/GPTService';
import type { IConfigService } from '../../config/ConfigService';
import type { IThreadManager } from '../../services/ThreadManager';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const guildId = 'synthetic-journey';
const reporterId = '10000000000000001';
const targetId = '10000000000000002';
const context = {
  guildId,
  requestId: 'journey',
  source: 'discord_interaction',
  actor: { kind: 'user' as const, userId: reporterId },
};
const authority = {
  loadFresh: async (guildId: string, userId: string) => ({
    guildId,
    userId,
    present: true,
    owner: false,
    permissions: userId === 'staff' ? '32' : '0',
    roleIds: [],
  }),
};
type Scenario =
  'clean' | 'multiple' | 'uncertain' | 'over-budget' | 'directory-unavailable' | 'no-match';

describeIntegration('staged report journey through persisted boundaries', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  async function fixture(initialScenario: Scenario = 'clean') {
    const prisma = getPrismaClient();
    let clock = Date.now();
    jest.useFakeTimers({
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    jest.setSystemTime(clock);
    const advance = (ms: number): void => {
      clock += ms;
      jest.setSystemTime(clock);
    };
    const servers = new ServerRepository(prisma);
    await servers.getOrCreateServer(guildId);
    await servers.updateSettings(guildId, { report_intake_staged_enabled: true });
    const users = new UserRepository(prisma);
    await users.getOrCreateUser(reporterId, 'river', new Date('2020-01-01'));
    const repository = new ReportIntakeRepository(prisma);
    const intake = await repository.create({
      serverId: guildId,
      reporterId,
      threadId: 'synthetic-thread',
    });
    const queueRepository = new ModerationQueueRepository(prisma);
    const effects = { addRole: jest.fn(), kick: jest.fn(), ban: jest.fn() };
    const target = {
      id: targetId,
      displayAvatarURL: () => null,
      nickname: 'Different nickname',
      displayName: 'Different nickname',
      roles: { add: effects.addRole },
      kick: effects.kick,
      ban: effects.ban,
      user: {
        username: 'opaque_account',
        globalName: 'Alder',
        bot: false,
        displayAvatarURL: () => null,
      },
    } as unknown as GuildMember;
    let scenario = initialScenario;
    const messages = new Map<string, Message>();
    const sent = new Map<string, { id: string; author: { id: string }; edit: jest.Mock }>();
    const send = jest.fn(async () => {
      const value = {
        id: `sent-${sent.size + 1}`,
        author: { id: 'bot' },
        edit: jest.fn().mockResolvedValue(undefined),
      };
      sent.set(value.id, value);
      return value;
    });
    const channel = {
      id: intake.thread_id,
      guildId,
      isThread: () => true,
      send,
      messages: {
        fetch: jest.fn(
          async (input: string | { message: string }) =>
            messages.get(typeof input === 'string' ? input : input.message) ??
            sent.get(typeof input === 'string' ? input : input.message)
        ),
      },
    };
    const list = jest.fn(async () => {
      if (scenario === 'directory-unavailable') throw new Error('directory unavailable');
      return new Collection([[targetId, target]]);
    });
    const guild = {
      id: guildId,
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
      members: { list, fetch: jest.fn().mockResolvedValue(target) },
    };
    const client = {
      user: { id: 'bot' },
      guilds: { fetch: jest.fn().mockResolvedValue(guild) },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    } as unknown as Client;
    const config = {
      getServerConfig: jest
        .fn()
        .mockResolvedValue({ settings: { report_intake_staged_enabled: true } }),
    } as unknown as IConfigService;
    const retire = jest.fn().mockResolvedValue(undefined);
    const threads = { retireReportConfirmationPrompts: retire } as unknown as IThreadManager;
    const create = jest.fn(
      async (request: { input: { content: { type: string; text?: string }[] }[] }) => {
        const refs = request.input[0].content
          .filter((part) => part.type === 'input_text')
          .map((part) => (JSON.parse(part.text!) as { sourceRef: ReportEvidenceRef }).sourceRef);
        const subject = (role: ReportSubjectClues['role'], name: string): ReportSubjectClues => ({
          subjectId: role,
          role,
          readability: scenario === 'uncertain' && role === 'target' ? 'uncertain' : 'clear',
          sourceRefs: refs,
          displayNames: [name],
          usernames: [],
          userIds: [],
          messageLinks: [],
          uncertainty: scenario === 'uncertain' && role === 'target' ? ['Partly obscured'] : [],
        });
        const output = {
          subjects: [
            subject('target', scenario === 'no-match' ? 'Missing account' : 'Alder'),
            ...(scenario === 'multiple'
              ? [subject('reporter', 'River'), subject('other', 'Finch')]
              : []),
          ],
          contextLabels: [{ kind: 'server', text: 'Synthetic workshop', sourceRefs: refs }],
        };
        return {
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }],
            },
          ],
        };
      }
    );
    const gpt = new GPTService({ responses: { create } } as unknown as OpenAI);
    const deliver = jest.fn(
      async ({
        intake: current,
        revision,
      }: Parameters<IModerationQueueService['upsertReportIdentityReview']>[0]) => {
        await queueRepository.upsert({
          serverId: guildId,
          userId: reporterId,
          reportIntakeId: current.id,
          sourceThreadId: current.thread_id,
          itemType: ModerationQueueItemType.REPORT_THREAD_ATTENTION,
          queueChannelId: 'review-channel',
          queueMessageId: 'review-message',
          metadata: { identity_review: { revision } },
        });
        return { delivered: true, channelId: 'review-channel', messageId: 'review-message' };
      }
    );
    const queue = {
      upsertReportIdentityReview: deliver,
      deleteReportThreadAttention: async (id: string) => {
        for (const item of await queueRepository.listByReportIntake(id))
          await queueRepository.deleteById(item.id);
      },
    } as unknown as IModerationQueueService;
    const restart = () => {
      const repo = new ReportIntakeRepository(prisma);
      const candidates = new ReportCandidateService();
      const service = new ReportIntakeService(
        repo,
        servers,
        users,
        new ServerMemberRepository(prisma),
        config,
        candidates,
        threads,
        queue
      );
      const agent = new ReportIntakeAgentService(repo, config, candidates, service, gpt, client);
      return {
        repo,
        service,
        worker: new ReportIntakeAnalysisWorker(repo, config, agent),
        handoff: new ReportIntakeHandoffService(repo, queue, client, service, threads),
      };
    };
    const add = async (text = 'I am reporting the account displayed as Alder.'): Promise<void> => {
      const message = {
        id: `evidence-${messages.size + 1}`,
        content: text,
        guild,
        guildId,
        channel,
        channelId: channel.id,
        author: { id: reporterId, bot: false },
        client,
        attachments: new Collection(),
        createdTimestamp: clock,
        editedTimestamp: null,
        system: false,
      } as unknown as Message;
      messages.set(message.id, message);
      expect(await restart().service.handleThreadMessage(message)).toBe(true);
    };
    const confirmed = jest.fn(async () => ({
      status: 'submitted' as const,
      targetUserId: targetId,
    }));
    const actions = () => {
      const { repo, service } = restart();
      return createReportActions({
        authority,
        settings: { loadFresh: async () => ({ reasonRequired: false, staffRoleIds: [] }) },
        intakes: {
          load: async (id) => {
            const current = await repo.findById(id);
            return current ? projectReportIntakeState(current) : null;
          },
          findOpen: async () => null,
          open: async () => {
            throw new Error('not used');
          },
          markOpenFailed: async () => {},
          confirm: async (ctx, command, staff) =>
            service.confirmCandidate({
              intakeId: command.intakeId,
              targetUserId: command.targetUserId,
              confirmedById: ctx.actor.kind === 'user' ? ctx.actor.userId : '',
              confirmedByStaff: staff,
              expectedEvidenceRevision: command.expectedEvidenceRevision,
              promptMessageId: command.promptMessageId,
              currentMember: reportDirectoryMember(target),
            }),
          reject: async () => {
            throw new Error('not used');
          },
          close: async (ctx, state, staff, command) =>
            service.closeIntakeForThread({
              threadId: state.threadId!,
              closedById: ctx.actor.kind === 'user' ? ctx.actor.userId : '',
              closedByStaff: staff,
              closeMode: command.closeMode,
              expectedEvidenceRevision: command.expectedEvidenceRevision,
              promptMessageId: command.promptMessageId,
            }),
          markSubmitted: async (_ctx, state) =>
            service.markSubmitted({
              intakeId: state.id,
              targetUserId: state.confirmedTargetUserId!,
              submittedById: reporterId,
            }),
        },
        threads: {
          create: async () => null,
          activate: async () => false,
          deleteFailed: async () => {},
          notifyOpened: async () => {},
          notifySubmitted: async () => {},
          prepareClose: async () => ({
            finish: async (result) => ({ archived: true, message: result.message }),
          }),
        },
        submissions: {
          confirmed,
          user: async () => {
            throw new Error('not used');
          },
          message: async () => {
            throw new Error('not used');
          },
        },
      });
    };
    const saved = async () => (await repository.findById(intake.id))!;
    const assertNoModeration = (): void => {
      for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
      expect(confirmed).not.toHaveBeenCalled();
    };
    return {
      repository,
      intake,
      add,
      advance,
      restart,
      saved,
      create,
      list,
      deliver,
      send,
      queueRepository,
      effects,
      confirmed,
      actions,
      assertNoModeration,
      setScenario: (value: Scenario) => {
        scenario = value;
      },
    };
  }

  it.each(['clean', 'multiple'] as const)(
    'resolves %s via global name, persists confirmation, then submits once after human confirmation',
    async (scenario) => {
      const f = await fixture(scenario);
      await f.add();
      f.advance(15_000);
      expect(await f.restart().worker.processPending()).toBe(1);
      const analyzed = await f.saved();
      expect(processingMetadata(analyzed).analysis.outcome).toMatchObject({
        kind: 'confirm',
        candidate: { discordUserId: targetId, matchedFields: ['globalName'] },
        coverage: { kind: 'complete', memberCount: 1 },
      });
      expect(analyzed.analysis_attempts).toBe(1);
      f.assertNoModeration();
      await f.restart().handoff.publishOutcome(f.intake.id);
      const state = projectReportIntakeState(await f.saved());
      expect(state.promptMessageId).not.toBeNull();
      f.assertNoModeration();
      const command = {
        kind: 'confirm_intake_candidate' as const,
        intakeId: f.intake.id,
        threadId: f.intake.thread_id!,
        targetUserId: targetId,
        promptMessageId: state.promptMessageId!,
        expectedEvidenceRevision: state.evidenceRevision,
      };
      const results = await Promise.all([
        f.actions().execute(context, command),
        f.actions().execute(context, command),
      ]);
      expect(
        results.filter(
          (result) => result.kind === 'outcome' && result.outcome.status === 'submitted'
        )
      ).toHaveLength(1);
      expect(f.confirmed).toHaveBeenCalledTimes(1);
      expect((await f.saved()).status).toBe('submitted');
      expect(f.create).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['uncertain', 'uncertain_text', 2],
    ['over-budget', 'evidence_over_budget', 0],
    ['directory-unavailable', 'lookup_failure', 1],
    ['no-match', 'no_match', 1],
  ] as const)(
    'hands off %s without moderation and preserves actual model budget',
    async (scenario, reason, requests) => {
      const f = await fixture(scenario);
      await f.add(scenario === 'over-budget' ? 'x'.repeat(2001) : undefined);
      f.advance(15_000);
      await f.restart().worker.processPending();
      expect(processingMetadata(await f.saved()).analysis.outcome).toMatchObject({
        kind: 'admin_review',
        reason,
      });
      expect((await f.saved()).analysis_attempts).toBe(requests);
      expect(f.create).toHaveBeenCalledTimes(requests);
      f.assertNoModeration();
      await f.restart().handoff.publishOutcome(f.intake.id);
      expect(processingMetadata(await f.saved()).analysis.handoff).toMatchObject({
        state: 'delivered',
        receipt: 'sent',
        reason,
      });
      expect(f.send).toHaveBeenCalledWith(
        expect.objectContaining({ content: REPORT_HANDOFF_RECEIPT })
      );
      f.assertNoModeration();
    }
  );

  it.each([false, true])(
    'recovers a claimed investigation after restart, request reserved: %s',
    async (reserved) => {
      const f = await fixture();
      await f.add();
      f.advance(15_000);
      const claim = (await f.repository.claimAnalysis(new Date(), 1000))!;
      if (reserved) expect(await f.repository.reserveModelAttempt(claim, new Date())).toBe(true);
      f.advance(1001);
      await f.restart().worker.processPending();
      const saved = await f.saved();
      expect(saved.analysis_attempts).toBe(reserved ? 2 : 1);
      expect(saved.analysis_deadline_at).toEqual(claim.deadline);
      expect(processingMetadata(saved).analysis.outcome?.kind).toBe('confirm');
      expect(await f.repository.reserveModelAttempt(claim, new Date())).toBe(false);
      f.assertNoModeration();
    }
  );

  it('reclaims a presentation lease after restart and routes unanswered confirmation to review', async () => {
    const f = await fixture();
    await f.add();
    f.advance(15_000);
    await f.restart().worker.processPending();
    const presentation = await f.repository.claimPendingPresentation(new Date(), f.intake.id);
    expect(presentation).not.toBeNull();
    f.advance(60_000);
    await f.restart().handoff.publishOutcome(f.intake.id);
    expect(projectReportIntakeState(await f.saved()).promptMessageId).not.toBeNull();
    f.advance(10 * 60_000);
    await f.restart().worker.processPending();
    await f.restart().handoff.publishOutcome(f.intake.id);
    expect(processingMetadata(await f.saved()).analysis).toMatchObject({
      outcome: { kind: 'admin_review', reason: 'confirmation_timeout' },
      handoff: { state: 'delivered' },
    });
    expect(f.create).toHaveBeenCalledTimes(1);
    f.assertNoModeration();
  });

  it('recovers delivery after restart and preserves acknowledgement across voluntary evidence', async () => {
    const f = await fixture('no-match');
    await f.add();
    f.advance(15_000);
    await f.restart().worker.processPending();
    f.deliver.mockRejectedValueOnce(new Error('delivery unavailable'));
    await f.restart().handoff.publishOutcome(f.intake.id);
    expect(processingMetadata(await f.saved()).analysis.handoff).toMatchObject({
      state: 'pending',
      attempts: 1,
    });
    f.advance(30_000);
    await f.restart().handoff.publishOutcome(f.intake.id);
    const [item] = await f.queueRepository.listByReportIntake(f.intake.id);
    const deleteQueueMessage = jest.fn();
    await createAttentionActions({
      authority,
      repository: f.queueRepository,
      messageDeleter: { deleteQueueMessage },
    }).acknowledge({ ...context, actor: { kind: 'user', userId: 'staff' } }, { itemId: item.id });
    expect(processingMetadata(await f.saved()).analysis.handoff.state).toBe('acknowledged');
    expect(deleteQueueMessage).not.toHaveBeenCalled();
    f.setScenario('clean');
    await f.add('Additional voluntary evidence: the global account name is Alder.');
    f.advance(60_000);
    await f.restart().worker.processPending();
    await f.restart().handoff.publishOutcome(f.intake.id);
    const saved = await f.saved();
    expect(saved.status).toBe('needs_admin_confirmation');
    expect(processingMetadata(saved).analysis).toMatchObject({
      outcome: {
        kind: 'admin_review',
        candidates: [expect.objectContaining({ discordUserId: targetId })],
      },
      handoff: { state: 'acknowledged', acknowledgedBy: 'staff', reason: 'no_match' },
    });
    expect(
      f.send.mock.calls.filter(
        (call) => (call as unknown as [{ content: string }])[0].content === REPORT_HANDOFF_RECEIPT
      )
    ).toHaveLength(1);
    expect(await f.queueRepository.listByReportIntake(f.intake.id)).toHaveLength(1);
    f.assertNoModeration();
  });

  it('records the existing failed-submission recovery limit without widening resolution policy', async () => {
    const f = await fixture('no-match');
    await f.add();
    f.advance(15_000);
    await f.restart().worker.processPending();
    await f.restart().handoff.publishOutcome(f.intake.id);
    const staff = { ...context, actor: { kind: 'user' as const, userId: 'staff' } };
    const state = projectReportIntakeState(await f.saved());
    f.confirmed.mockRejectedValueOnce(new Error('submission unavailable'));
    await expect(
      f.actions().execute(staff, {
        kind: 'confirm_intake_candidate',
        intakeId: f.intake.id,
        threadId: f.intake.thread_id!,
        targetUserId: targetId,
        expectedEvidenceRevision: state.evidenceRevision,
        promptMessageId: state.promptMessageId!,
      })
    ).rejects.toThrow('submission unavailable');
    expect(
      await f.actions().execute(staff, {
        kind: 'close_report_intake',
        intakeId: f.intake.id,
        expectedEvidenceRevision: state.evidenceRevision,
        promptMessageId: state.promptMessageId!,
        closeMode: { kind: 'resolve_review', reason: 'Cannot finish submission' },
      })
    ).toEqual({ kind: 'denied', code: 'stale_state' });
    expect((await f.saved()).confirmed_target_user_id).toBe(targetId);
    expect((await f.saved()).status).toBe('needs_admin_confirmation');
    expect(await f.queueRepository.listByReportIntake(f.intake.id)).toHaveLength(1);
  });
});
