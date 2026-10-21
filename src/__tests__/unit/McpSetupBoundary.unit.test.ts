import { Collection, type Client, type Guild } from 'discord.js';
import { mockDeep } from 'jest-mock-extended';
import {
  encodeQueuedAction,
  parseSetupStoredRecord,
  completeSetupCommandSchema,
  projectHumanOutcome,
  selectSetupProvisioning,
  type ExecutionRecord,
  type QueuedSetupCommand,
} from '@drasil/application';
import { createBotSetupRuntime, type BotSetupDependencies } from '../../application/adapters/setup';
import { ConfigService } from '../../config/ConfigService';
import { InMemoryServerRepository } from '../fakes/inMemoryRepositories';
import { dispatchSetupAction } from '../../application/setupDispatch';

const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'mcp',
  actor: { kind: 'user' as const, userId: 'actor' },
};
it.each<QueuedSetupCommand>([
  {
    kind: 'update_settings',
    section: 'caseStaff',
    changes: { case_responder_role_ids: ['foreign'] },
  },
  { kind: 'lockdown_allow_add', targetKind: 'category', targetId: 'foreign' },
])('rechecks current guild resources in the admitted queued $kind execution', async (command) => {
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'in-memory';
  try {
    const repository = new InMemoryServerRepository();
    const server = await repository.upsertByGuildId('guild', {});
    const client = mockDeep<Client>();
    client.guilds.fetch.mockResolvedValue({
      roles: { fetch: async () => new Collection() },
      channels: { fetch: async () => new Collection() },
    } as never);
    const config = new ConfigService(repository, client);
    const save = jest.spyOn(config, 'updateSetupIfUnchanged');
    const deps = mockDeep<BotSetupDependencies>();
    const encoded = encodeQueuedAction(context, command);
    deps.actionRequests.findById.mockResolvedValue({
      id: 'request',
      server_id: 'guild',
      actor_id: 'actor',
      actor_surface: 'mcp',
      target_user_id: null,
      action_type: encoded.actionType,
      metadata: encoded.metadata,
    } as never);
    const runtime = createBotSetupRuntime(
      { ...deps, client, configService: config },
      {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          owner: true,
          present: true,
          permissions: '8',
          roleIds: [],
        }),
      }
    ).forExecution({
      preconditions: {
        kind: 'setup',
        approvedState: parseSetupStoredRecord(server as unknown as Record<string, unknown>),
      },
    } as ExecutionRecord);
    await expect(runtime.execute(context, command, { kind: 'queued' })).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
    expect(save).not.toHaveBeenCalled();
  } finally {
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
  }
});

describe('live setup failure projection', () => {
  const oldUrl = process.env.DATABASE_URL;
  beforeEach(() => {
    process.env.DATABASE_URL = 'in-memory';
  });
  afterAll(() => {
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
  });
  async function fixture(
    failure: 'candidate' | 'selection' | 'verification' | 'final' | 'save' | 'panel',
    mode: 'provision' | 'verification_modal' = 'provision',
    source = 'mcp'
  ) {
    const ctx = { ...context, source };
    const command = completeSetupCommandSchema.parse({
      kind: 'complete_setup_verification',
      mode,
      adminChannelId: 'admin',
      caseRoleId: 'case',
      caseRoleName: null,
      verificationChannelId: mode === 'provision' ? 'verification' : undefined,
      reportInstructionsChannelId: failure === 'panel' ? 'report' : null,
      submissionId: ctx.requestId,
      onboardingWizard: false,
    });
    const repository = new InMemoryServerRepository();
    const server = await repository.upsertByGuildId('guild', {
      case_role_id: 'case',
      admin_channel_id: 'admin',
      verification_channel_id: 'verification',
      admin_notification_role_id: failure === 'selection' ? 'case' : null,
    });
    const role = { id: 'case', name: 'Case' };
    const channels = new Collection([
      ['admin', { id: 'admin', name: 'admin', type: 0, guildId: 'guild' }],
      ['verification', { id: 'verification', name: 'verification', type: 0, guildId: 'guild' }],
      ['report', { id: 'report', name: 'report', type: 0, guildId: 'guild' }],
    ]);
    const roles = new Collection([[role.id, role]]);
    const createRole = jest.fn();
    const guild = {
      id: 'guild',
      roles: {
        cache: roles,
        fetch: async (id?: string) => (id ? roles.get(id) : roles),
        create: createRole,
      },
      channels: {
        cache: channels,
        fetch: async (id?: string) => (id ? channels.get(id) : channels),
      },
    } as unknown as Guild;
    const client = mockDeep<Client>();
    client.guilds.fetch.mockResolvedValue(guild as never);
    client.channels.fetch.mockImplementation(
      async (id) => (id === 'report' ? null : channels.get(id)) as never
    );
    const config = new ConfigService(repository, client);
    const save = jest.spyOn(config, 'updateSetupIfUnchanged');
    if (failure === 'save') save.mockRejectedValue(new Error('private database failure'));
    const deps = mockDeep<BotSetupDependencies>();
    const ready = {
      guildId: 'guild',
      checkedAt: new Date(),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    };
    const blocked = {
      ...ready,
      issues: [
        {
          severity: 'error' as const,
          code: 'guild-manage-roles',
          message: 'private diagnostic text',
        },
      ],
      errorCount: 1,
    };
    deps.setupDiagnosticsService.validateSetupCandidate.mockResolvedValue(blocked);
    if (failure !== 'candidate')
      deps.setupDiagnosticsService.validateSetupCandidate.mockResolvedValue(ready);
    if (failure === 'final')
      deps.setupDiagnosticsService.validateSetupCandidate
        .mockResolvedValueOnce(ready)
        .mockResolvedValueOnce(blocked);
    deps.notificationManager.setupVerificationChannel.mockImplementation(
      async (_guild, _role, _persist, _created, _channel, updated) => {
        await updated?.(
          { channelId: 'verification', entries: [] },
          { channel_id: 'verification', managed_overwrites: [] }
        );
        return failure === 'verification' ? null : 'verification';
      }
    );
    deps.notificationManager.restoreVerificationChannelPermissions = jest
      .fn()
      .mockResolvedValue(false);
    deps.actionRequests.mergeMetadata.mockResolvedValue({} as never);
    const encoded = encodeQueuedAction(ctx, command);
    deps.actionRequests.findById.mockResolvedValue({
      id: ctx.requestId,
      server_id: ctx.guildId,
      actor_id: 'actor',
      actor_surface: source,
      target_user_id: null,
      action_type: encoded.actionType,
      metadata: encoded.metadata,
    } as never);
    let runtime = createBotSetupRuntime(
      {
        ...deps,
        client,
        configService: config,
        productAnalyticsService: deps.productAnalyticsService,
      },
      {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          present: true,
          owner: true,
          permissions: '8',
          roleIds: [],
        }),
      }
    );
    if (source === 'mcp') {
      const approvedState = parseSetupStoredRecord(server as unknown as Record<string, unknown>);
      runtime = runtime.forExecution({
        preconditions: {
          kind: 'setup',
          approvedState,
          provisioning: selectSetupProvisioning(approvedState, command, {
            roles: [...roles.values()],
            channels: [...channels.values()],
          }),
        },
      } as ExecutionRecord);
    }
    return {
      deps,
      save,
      createRole,
      command,
      dispatch: () => dispatchSetupAction(runtime, ctx, command),
    };
  }
  it.each(['provision', 'verification_modal'] as const)(
    'projects %s candidate validation failure without effects',
    async (mode) => {
      const f = await fixture('candidate', mode);
      const result = projectHumanOutcome(f.command, await f.dispatch());
      expect(result).toMatchObject({
        state: 'failed',
        code: 'candidate_validation_failed',
        outcome: {
          details: { error_count: 1, warning_count: 0, diagnostic_code: 'guild-manage-roles' },
        },
      });
      expect(JSON.stringify(result)).not.toContain('private diagnostic text');
      expect(f.createRole).not.toHaveBeenCalled();
      expect(f.deps.notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    }
  );
  it('projects a role conflict as a definite selection denial before effects', async () => {
    const f = await fixture('selection');
    expect(projectHumanOutcome(f.command, await f.dispatch())).toMatchObject({
      state: 'denied',
      code: 'invalid_selection',
    });
    expect(f.deps.setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(f.deps.notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it.each([
    ['verification', 'verification_channel_failed'],
    ['final', 'final_validation_failed'],
    ['save', 'config_save_failed'],
  ] as const)(
    'retains uncertainty after actual verification effects and %s failure',
    async (failure, code) => {
      const f = await fixture(failure);
      const result = projectHumanOutcome(f.command, await f.dispatch());
      expect(result).toMatchObject({ state: 'uncertain', code });
      expect(f.deps.notificationManager.setupVerificationChannel).toHaveBeenCalledTimes(1);
      expect(
        f.deps.notificationManager.restoreVerificationChannelPermissions
      ).toHaveBeenCalledTimes(1);
      if (failure === 'save') expect(f.save).toHaveBeenCalledTimes(1);
      else expect(f.save).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('private');
    }
  );
  it('retains the native website validation exception', async () => {
    const f = await fixture('candidate', 'provision', 'web');
    await expect(f.dispatch()).rejects.toThrow('Setup validation failed. 1 error(s)');
  });
  it('preserves partial completion when saved setup is followed by panel failure', async () => {
    const f = await fixture('panel');
    const result = projectHumanOutcome(f.command, await f.dispatch());
    expect(result.state).toBe('partial');
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.deps.notificationManager.setupVerificationChannel).toHaveBeenCalledTimes(1);
    expect(f.deps.notificationManager.restoreVerificationChannelPermissions).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('not found');
  });
});
