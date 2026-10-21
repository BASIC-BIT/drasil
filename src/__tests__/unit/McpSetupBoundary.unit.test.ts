import { Collection, type Client } from 'discord.js';
import { mockDeep } from 'jest-mock-extended';
import {
  encodeQueuedAction,
  parseSetupStoredRecord,
  type ExecutionRecord,
  type QueuedSetupCommand,
} from '@drasil/application';
import { createBotSetupRuntime, type BotSetupDependencies } from '../../application/adapters/setup';
import { ConfigService } from '../../config/ConfigService';
import { InMemoryServerRepository } from '../fakes/inMemoryRepositories';

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
