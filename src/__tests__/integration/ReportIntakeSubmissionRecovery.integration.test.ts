import { createBotReportActions } from '../../application/adapters/reports';
import {
  projectReportIntakeState,
  type ActionContext,
  type ReportCommand,
} from '@drasil/application';
import { Client } from 'discord.js';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { ReportIntakeService } from '../../services/ReportIntakeService';
import { ReportCandidateService } from '../../services/ReportCandidateService';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import type { IThreadManager } from '../../services/ThreadManager';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import type { IConfigService } from '../../config/ConfigService';
import { processingMetadata } from '../../repositories/reportIntakeProcessing';
import { ReportIntakeStatus, ReportIntakeEvidenceKind } from '../../repositories/types';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const targetId = '222222222222222222';
const staff: ActionContext = {
  guildId: 'recovery-guild',
  requestId: 'recovery',
  source: 'discord_interaction',
  actor: { kind: 'user', userId: 'staff' },
};

describeIntegration('confirmed intake submission recovery', () => {
  async function fixture(reporter = false) {
    const prisma = getPrismaClient();
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    await servers.getOrCreateServer(staff.guildId);
    await servers.updateSettings(staff.guildId, { report_intake_staged_enabled: true });
    for (const id of ['reporter', targetId, 'staff']) await users.getOrCreateUser(id, id);
    const repository = new ReportIntakeRepository(prisma);
    const intake = await repository.create({
      serverId: staff.guildId,
      reporterId: 'reporter',
      threadId: 'recovery-thread',
      status: reporter
        ? ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
        : ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
    });
    const candidate = {
      candidateId: 'target',
      serverId: staff.guildId,
      discordUserId: targetId,
      username: 'opaque',
      globalName: 'Alder',
      displayName: 'Different nickname',
      nickname: 'Different nickname',
      avatarUrl: null,
      matchedFields: ['globalName' as const],
      sourceRefs: [],
      subjectMatches: [
        { subjectId: 'target', sourceRefs: [], matchedFields: ['globalName' as const] },
      ],
    };
    const { analysis } = processingMetadata(intake);
    const coverage = { kind: 'not_required' as const, reason: 'validated_anchor' as const };
    analysis.outcome = reporter
      ? { kind: 'confirm', candidate, coverage, includedEvidenceIds: [], excludedEvidenceIds: [] }
      : {
          kind: 'admin_review',
          reason: 'ambiguous',
          candidates: [candidate],
          coverage,
          includedEvidenceIds: [],
          excludedEvidenceIds: [],
        };
    if (!reporter)
      analysis.handoff = {
        state: 'delivered',
        reason: 'ambiguous',
        attempts: 1,
        nextDueAt: new Date().toISOString(),
        receipt: 'sent',
        channelId: 'queue',
        messageId: 'review',
      };
    await repository.update(intake.id, {
      metadata: {
        analysis,
        candidate_suggestions: [
          {
            ...candidate,
            matchReasons: [],
            confidence: 1,
            ambiguityNotes: [],
            platformBackedEvidence: [],
            confirmationRequired: true,
          },
        ],
        last_confirmation_prompt_revision: 0,
        last_confirmation_prompt_message_id: 'prompt',
        last_confirmation_prompt_candidate_ids: [targetId],
        last_confirmation_prompt_token: 'prompt-token',
        confirmation_prompt_message_ids: reporter ? ['prompt'] : [],
        admin_review_prompt_message_id: 'review',
        admin_review_prompt_revision: 0,
      },
    });
    await repository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.REPORTER_TEXT,
      content: 'Synthetic report evidence',
    });
    const config = {
      getServerConfig: jest
        .fn()
        .mockResolvedValue({ settings: { report_intake_staged_enabled: true } }),
    } as unknown as IConfigService;
    const threads = {
      retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined),
    } as unknown as IThreadManager;
    const queue = {
      deleteReportThreadAttention: jest.fn().mockResolvedValue(undefined),
    } as unknown as IModerationQueueService;
    const service = new ReportIntakeService(
      repository,
      servers,
      users,
      new ServerMemberRepository(prisma),
      config,
      new ReportCandidateService(),
      threads,
      queue
    );
    const member = {
      id: targetId,
      guild: { id: staff.guildId },
      displayName: 'Different nickname',
      nickname: 'Different nickname',
      user: {
        id: targetId,
        username: 'opaque',
        globalName: 'Alder',
        bot: false,
        displayAvatarURL: () => null,
      },
    };
    const fetchMember = jest.fn().mockResolvedValue(member);
    const channel = {
      id: 'recovery-thread',
      guildId: staff.guildId,
      isThread: () => true,
      send: jest.fn().mockResolvedValue({ id: 'receipt' }),
      setArchived: jest.fn().mockResolvedValue(undefined),
    };
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({ id: staff.guildId, members: { fetch: fetchMember } }),
      },
      users: { fetch: jest.fn().mockResolvedValue({ id: 'reporter' }) },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    } as unknown as Client;
    const security = {
      handleConfirmedReportIntake: jest.fn().mockResolvedValue(true),
      hasConfirmedReportIntakeReceipt: jest.fn().mockResolvedValue(false),
    };
    const publishOutcome = jest.fn().mockResolvedValue(undefined);
    const actions = createBotReportActions(
      {
        client,
        configService: config,
        reportIntakeService: service,
        threadManager: threads,
        securityActionService: security as unknown as ISecurityActionService,
        reportIntakeHandoffService: { publishOutcome, deliverPending: jest.fn() },
      },
      {
        loadFresh: async (guildId, userId) => ({
          guildId,
          userId,
          present: true,
          owner: userId === 'staff',
          permissions: '0',
          roleIds: [],
        }),
      }
    );
    const actor = reporter
      ? { ...staff, actor: { kind: 'user' as const, userId: 'reporter' } }
      : staff;
    const confirm = () =>
      actions.execute(actor, {
        kind: 'confirm_intake_candidate',
        intakeId: intake.id,
        threadId: 'recovery-thread',
        targetUserId: targetId,
        promptMessageId: reporter ? 'prompt' : 'review',
        expectedEvidenceRevision: 0,
      });
    const saved = async () => (await repository.findById(intake.id))!;
    const recoveryCommand = async (): Promise<
      Extract<ReportCommand, { kind: 'close_report_intake' }>
    > => {
      const state = projectReportIntakeState(await saved());
      return {
        kind: 'close_report_intake',
        intakeId: intake.id,
        expectedEvidenceRevision: state.evidenceRevision,
        closeMode: {
          kind: 'resolve_submission',
          token: state.submission!.token,
          reason: 'Checked the current moderation record and handled the report separately.',
          verifiedOutcome: 'handled_separately',
        },
      };
    };
    return {
      repository,
      intake,
      service,
      security,
      actions,
      confirm,
      saved,
      recoveryCommand,
      fetchMember,
      threads,
      publishOutcome,
    };
  }

  it.each([false, true])(
    'makes a settled unknown discoverable and lets staff record verified resolution, reporter=%s',
    async (reporter) => {
      const f = await fixture(reporter);
      f.security.handleConfirmedReportIntake.mockRejectedValue(new Error('acceptance unknown'));
      await expect(f.confirm()).rejects.toThrow('acceptance unknown');
      const saved = await f.saved();
      expect(saved).toMatchObject({
        status: 'needs_admin_confirmation',
        confirmed_target_user_id: targetId,
        metadata: {
          submission: { state: 'unknown', settledAt: expect.any(String) },
          analysis: { outcome: { reason: 'submission_recovery' } },
        },
      });
      expect(await f.repository.claimPendingPresentation(new Date(), f.intake.id)).not.toBeNull();
      expect(f.publishOutcome).toHaveBeenCalledWith(f.intake.id);
      if (!reporter)
        expect(f.threads.retireReportConfirmationPrompts).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.arrayContaining(['review'])
        );
      const command = await f.recoveryCommand();
      expect(
        await f.actions.execute({ ...staff, actor: { kind: 'user', userId: 'reporter' } }, command)
      ).toMatchObject({ kind: 'denied' });
      expect(await f.actions.execute(staff, command)).toMatchObject({
        kind: 'outcome',
        outcome: { status: 'closed' },
      });
      expect(await f.saved()).toMatchObject({
        status: 'closed_by_reporter',
        confirmed_target_user_id: targetId,
        metadata: {
          submission_resolution: {
            authority: 'staff_verified_settled_unknown',
            actorId: 'staff',
            outcome: 'handled_separately',
          },
        },
      });
      expect(f.security.handleConfirmedReportIntake).toHaveBeenCalledTimes(1);
    }
  );

  it('records known not-dispatched failure and fences a late dispatch after staff resolves it', async () => {
    const f = await fixture();
    f.fetchMember.mockRejectedValue(new Error('member unavailable'));
    await expect(f.confirm()).rejects.toThrow('member unavailable');
    expect(projectReportIntakeState(await f.saved()).submission?.state).toBe('not_dispatched');
    const command = await f.recoveryCommand();
    await f.actions.execute(staff, command);
    expect(
      await f.service.beginConfirmedSubmission(
        f.intake.id,
        command.closeMode?.kind === 'resolve_submission' ? command.closeMode.token : ''
      )
    ).toBe(false);
    expect(f.security.handleConfirmedReportIntake).not.toHaveBeenCalled();
  });

  it('rejects closure while dispatching and gives one terminal winner after settlement', async () => {
    const f = await fixture();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.security.handleConfirmedReportIntake.mockImplementation(async () => {
      entered();
      await pending;
      throw new Error('unknown');
    });
    const submitting = f.confirm();
    const rejected = submitting.catch((error: unknown) => error);
    await ready;
    const command = await f.recoveryCommand();
    expect(await f.actions.execute(staff, command)).toMatchObject({
      outcome: {
        status: 'not_closed',
        result: { message: expect.stringContaining('still be in progress') },
      },
    });
    expect((await f.saved()).closed_at).toBeNull();
    finish();
    await expect(rejected).resolves.toMatchObject({ message: 'unknown' });
    const results = await Promise.all([
      f.actions.execute(staff, command),
      f.actions.execute(staff, command),
    ]);
    expect(
      results.filter((result) => result.kind === 'outcome' && result.outcome.status === 'closed')
    ).toHaveLength(1);
    expect(f.security.handleConfirmedReportIntake).toHaveBeenCalledTimes(1);
  });

  it('reconciles accepted routing after progress persistence fails without another dispatch', async () => {
    const f = await fixture();
    f.security.hasConfirmedReportIntakeReceipt.mockResolvedValue(true);
    jest
      .spyOn(f.service, 'settleConfirmedSubmission')
      .mockRejectedValueOnce(new Error('status write failed'));
    await expect(f.confirm()).rejects.toThrow('status write failed');
    expect(projectReportIntakeState(await f.saved()).submission?.state).toBe('dispatching');
    expect(await f.actions.execute(staff, await f.recoveryCommand())).toMatchObject({
      outcome: {
        status: 'closed',
        result: { message: expect.stringContaining('Completed submission reconciled') },
      },
    });
    expect(await f.saved()).toMatchObject({
      status: 'submitted',
      metadata: { submission_resolution: { outcome: 'accepted_receipt' } },
    });
    expect(f.security.hasConfirmedReportIntakeReceipt).toHaveBeenCalledWith(
      f.intake.id,
      targetId,
      expect.any(String),
      staff.guildId
    );
    expect(f.security.handleConfirmedReportIntake).toHaveBeenCalledTimes(1);
  });
});
