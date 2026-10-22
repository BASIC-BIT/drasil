import { mockDeep } from 'jest-mock-extended';
import type { Guild, GuildMember, User } from 'discord.js';
import {
  UserModerationService,
  type NativeEnforcementLifecycle,
} from '../../services/UserModerationService';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';

function fixture(path: 'member' | 'by_id' | 'kick') {
  const repository = mockDeep<IVerificationEventRepository>();
  repository.findByUserAndServer.mockResolvedValue([]);
  const service = new UserModerationService(
    mockDeep(),
    mockDeep(),
    mockDeep(),
    repository,
    mockDeep(),
    mockDeep()
  );
  const user = { id: 'target', username: 'target', tag: 'target' } as User;
  const guild = {
    id: 'guild',
    client: { users: { fetch: jest.fn(async () => user) } },
    bans: { create: jest.fn(async () => undefined) },
  } as unknown as Guild;
  const member = {
    id: 'target',
    guild,
    user,
    ban: jest.fn(async () => undefined),
    kick: jest.fn(async () => undefined),
  } as unknown as GuildMember;
  const moderator = { id: 'actor' } as User;
  const provider =
    path === 'kick' ? member.kick : path === 'by_id' ? guild.bans.create : member.ban;
  const run = (lifecycle: NativeEnforcementLifecycle) =>
    path === 'kick'
      ? service.kickUser(member, 'reason', moderator, undefined, lifecycle)
      : path === 'by_id'
        ? service.banUserById(guild, user.id, 'reason', moderator, undefined, lifecycle)
        : service.banUser(member, 'reason', moderator, undefined, lifecycle);
  return { service, provider, run };
}
it.each(['member', 'by_id', 'kick'] as const)(
  'persists %s send marker before provider and acknowledgement before later work',
  async (path) => {
    const f = fixture(path);
    const order: string[] = [];
    const provider = jest.mocked(f.provider);
    provider.mockImplementation(async () => {
      order.push('provider');
      return undefined as never;
    });
    const lifecycle = {
      beforeSend: jest.fn(async () => {
        order.push('start');
      }),
      acknowledged: jest.fn(async () => {
        order.push('ack');
        throw new Error('stop before bookkeeping');
      }),
    };
    await expect(f.run(lifecycle)).rejects.toThrow('stop before bookkeeping');
    expect(order).toEqual(['start', 'provider', 'ack']);
    expect(provider).toHaveBeenCalledTimes(1);
  }
);
it.each(['member', 'by_id', 'kick'] as const)(
  'does not send %s when fence persistence fails',
  async (path) => {
    const f = fixture(path);
    await expect(
      f.run({
        beforeSend: async () => {
          throw new Error('fence unavailable');
        },
        acknowledged: jest.fn(),
      })
    ).rejects.toThrow('fence unavailable');
    expect(f.provider).not.toHaveBeenCalled();
  }
);
it.each(['member', 'by_id', 'kick'] as const)(
  'does not acknowledge %s timeout as success',
  async (path) => {
    const f = fixture(path);
    jest.mocked(f.provider).mockRejectedValueOnce(new Error('timeout'));
    const lifecycle = { beforeSend: jest.fn(async () => undefined), acknowledged: jest.fn() };
    await expect(f.run(lifecycle)).rejects.toThrow('timeout');
    expect(lifecycle.acknowledged).not.toHaveBeenCalled();
    expect(f.provider).toHaveBeenCalledTimes(1);
  }
);
