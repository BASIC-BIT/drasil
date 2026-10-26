import { mockDeep } from 'jest-mock-extended';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { createDelegatedCaseActions } from '../../application/adapters/delegatedCases';
import {
  canonicalDigest,
  resolveCasePreconditions,
  selectedMessageFingerprint,
  readCasePolicy,
  type CaseCommand,
  type ExecutionRecord,
} from '@drasil/application';
import type { BotCaseDependencies } from '../../application/adapters/cases';
import type { NativeEnforcementStore } from '@drasil/application/postgres';
const guildId = '100000000000000001',
  actorId = '100000000000000002',
  targetId = '100000000000000003',
  channelId = '100000000000000004',
  messageId = '100000000000000005';
async function fixture() {
  const command: CaseCommand = {
    kind: 'ban_user',
    targetUserId: targetId,
    reason: null,
    intent: 'native_action',
    selectedMessage: { channelId, messageId },
  };
  const state = {
    content: 'first',
    author: targetId,
    guildId,
    visible: true,
    botVisible: true,
    private: false,
    parentRevoked: false,
    actorMember: true,
    botMember: true,
  };
  const deps = mockDeep<BotCaseDependencies>();
  deps.configService.getServerConfig.mockResolvedValue({ settings: {} } as never);
  deps.confirmations.verify.mockResolvedValue(true);
  deps.verificationEventRepository.findById.mockResolvedValue(null);
  deps.verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(null);
  const actor = {
    id: actorId,
    permissions: new PermissionsBitField(P.BanMembers),
    roles: { cache: new Map() },
  };
  const bot = {
    id: '100000000000000006',
    permissions: new PermissionsBitField(P.BanMembers),
    roles: { cache: new Map() },
  };
  const message = () => ({
    id: messageId,
    guildId: state.guildId,
    channelId,
    author: { id: state.author },
    content: state.content,
    attachments: new Map(),
  });
  let parentAllows = true;
  const channel = {
    parentId: '100000000000000007',
    id: channelId,
    guildId,
    isTextBased: () => true,
    isThread: () => state.private,
    get type() {
      return state.private ? 12 : 0;
    },
    permissionsFor: (member: { id: string }) =>
      new PermissionsBitField(
        (member.id === actorId ? state.visible : state.botVisible) &&
          (!state.private || parentAllows)
          ? P.ViewChannel | P.ReadMessageHistory
          : 0n
      ),
    members: {
      fetch: async ({ member }: { member: string }) => {
        if (member === actorId ? !state.actorMember : !state.botMember)
          throw new Error('not member');
        return { id: member };
      },
    },
    messages: { fetch: async () => message() },
  };
  const guild = {
    id: guildId,
    ownerId: 'other',
    roles: { fetch: async () => undefined },
    channels: {
      fetch: async (id: string) => {
        if (id === channel.parentId) {
          parentAllows = !state.parentRevoked;
          return { id: channel.parentId, guildId, isThread: () => false };
        }
        return channel;
      },
    },
    members: { fetch: async () => actor, fetchMe: async () => bot },
  };
  deps.client.guilds.fetch.mockResolvedValue(guild as never);
  deps.client.channels.fetch.mockResolvedValue(channel as never);
  deps.client.users.fetch.mockResolvedValue({ id: actorId } as never);
  deps.userModerationService.banUser.mockResolvedValue(true);
  const binding = { guildId, channelId, messageId, userId: targetId };
  const preconditions = await resolveCasePreconditions(guildId, command, {
    repository: {
      findById: async () => null,
      findActive: async () => null,
      findDetection: async () => null,
    },
    settings: { loadFresh: async () => readCasePolicy({}) },
    selectedMessage: async () => ({
      ...binding,
      fingerprint: selectedMessageFingerprint({ ...binding, content: 'first', attachments: [] }),
    }),
  });
  const execution = {
    executionId: 'execution',
    guildId,
    userId: actorId,
    workflowId: 'ban_user',
    command,
    commandDigest: canonicalDigest(command),
    preconditions,
  } as ExecutionRecord;
  const native = mockDeep<NativeEnforcementStore>();
  const actions = createDelegatedCaseActions(deps, execution, native);
  const run = () =>
    actions.execute(
      { guildId, requestId: 'request', source: 'mcp', actor: { kind: 'user', userId: actorId } },
      command
    );
  return { state, deps, native, run };
}
it('lets a Ban-only actor use the exact still-visible selected message', async () => {
  const f = await fixture();
  expect(await f.run()).toMatchObject({ kind: 'outcome', outcome: { succeeded: true } });
  expect(f.deps.userModerationService.banUser).toHaveBeenCalledTimes(1);
});
it.each([
  'edit',
  'author',
  'guild',
  'actor_visibility',
  'bot_visibility',
  'actor_private',
  'bot_private',
] as const)('rechecks selected message %s immediately at execution', async (change) => {
  const f = await fixture();
  switch (change) {
    case 'edit':
      f.state.content = 'changed';
      break;
    case 'author':
      f.state.author = 'other';
      break;
    case 'guild':
      f.state.guildId = 'other';
      break;
    case 'actor_visibility':
      f.state.visible = false;
      break;
    case 'bot_visibility':
      f.state.botVisible = false;
      break;
    case 'actor_private':
      f.state.private = true;
      f.state.actorMember = false;
      break;
    case 'bot_private':
      f.state.private = true;
      f.state.botMember = false;
      break;
  }
  await expect(f.run()).rejects.toThrow();
  expect(f.deps.userModerationService.banUser).not.toHaveBeenCalled();
  expect(f.native.start).not.toHaveBeenCalled();
});

it('refreshes thread parent overwrites before resolving execution visibility', async () => {
  const f = await fixture();
  f.state.private = true;
  expect(await f.run()).toMatchObject({ kind: 'outcome' });
  f.state.parentRevoked = true;
  await expect(f.run()).rejects.toThrow();
  expect(f.deps.userModerationService.banUser).toHaveBeenCalledTimes(1);
});
