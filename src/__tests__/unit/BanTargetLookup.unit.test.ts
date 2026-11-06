import { mockDeep } from 'jest-mock-extended';
import {
  createBotCaseDependencies,
  type BotCaseDependencies,
} from '../../application/adapters/cases';

test.each([10007, 50013, 'network'])(
  'standalone ban treats only Unknown Member as absence (%s)',
  async (code) => {
    const deps = mockDeep<BotCaseDependencies>();
    const failure = { code };
    const guild = {
      members: {
        fetchMe: jest.fn().mockResolvedValue({ permissions: { has: () => true } }),
        fetch: jest.fn().mockRejectedValue(failure),
      },
    };
    deps.client.guilds.fetch.mockResolvedValue(guild as never);
    deps.userModerationService.banUserById.mockResolvedValue(true);
    const workflows = createBotCaseDependencies(deps).workflows;
    const result = workflows.ban({
      guildId: 'guild',
      targetUserId: '123456789012345678',
      actorId: 'actor',
      reason: 'Reason',
      detectionEventId: undefined,
      sourceSurface: 'discord',
    });
    if (code === 10007) {
      await expect(result).resolves.toBe(true);
      expect(deps.userModerationService.banUserById).toHaveBeenCalled();
    } else {
      await expect(result).rejects.toEqual(failure);
      expect(deps.userModerationService.banUserById).not.toHaveBeenCalled();
    }
  }
);
