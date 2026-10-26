import { PermissionFlagsBits } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';
import { handleSlashCommandConfirmationButton } from '../../utils/slashCommandConfirmations';

function arrange() {
  const getServerConfig = jest.fn().mockResolvedValue({ settings: {} });
  const target = { id: 'user-1', tag: 'target#0001' };
  const guild = {
    id: 'guild-1',
    members: {
      me: { permissions: { has: () => true } },
      fetchMe: jest.fn().mockResolvedValue({ permissions: { has: () => true } }),
      fetch: jest.fn().mockResolvedValue(null),
    },
  };
  const client = {
    guilds: { fetch: async () => guild },
    users: { fetch: async () => ({ id: 'moderator-1' }) },
  };
  const fixture = buildHandler({ getServerConfig, client });
  const interaction = {
    id: 'slash-1',
    commandName: 'ban',
    guildId: guild.id,
    guild,
    user: { id: 'moderator-1' },
    memberPermissions: { has: (bit: bigint) => bit === PermissionFlagsBits.BanMembers },
    options: { getUser: () => target, getString: () => null },
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  } as any;
  const confirm = async () =>
    handleSlashCommandConfirmationButton({
      id: 'confirm-1',
      customId: interaction.reply.mock.calls[0][0].components[0].components[0].toJSON().custom_id,
      user: interaction.user,
      guildId: guild.id,
      update: jest.fn(),
      reply: jest.fn(),
      editReply: interaction.editReply,
    } as any);
  return { ...fixture, getServerConfig, interaction, confirm, guild };
}
test.each([
  { moderator_ban_action_enabled: false },
  { moderator_ban_action_requires_reason: true },
])('slash confirmation rechecks changed policy %j', async (settings) => {
  const f = arrange();
  await f.handler.handleSlashCommand(f.interaction);
  f.getServerConfig.mockResolvedValue({ settings });
  await f.confirm();
  expect(f.userModerationService.banUserById).not.toHaveBeenCalled();
  expect(f.userModerationService.banUser).not.toHaveBeenCalled();
});
test('ban_by_id_preserves_departed_subject', async () => {
  const f = arrange();
  await f.handler.handleSlashCommand(f.interaction);
  await f.confirm();
  const departedBanTargetId = f.userModerationService.banUserById.mock.calls[0][1];
  expect(departedBanTargetId).toBe('user-1');
});
test('expired slash confirmation cannot enforce', async () => {
  jest.useFakeTimers();
  try {
    const f = arrange();
    await f.handler.handleSlashCommand(f.interaction);
    jest.advanceTimersByTime(10 * 60 * 1000 + 1);
    await f.confirm();
    const enforcementCountAfterExpiredConfirmation =
      f.userModerationService.banUserById.mock.calls.length;
    expect(enforcementCountAfterExpiredConfirmation).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('slash execution rechecks fresh bot capabilities', async () => {
  const f = arrange();
  await f.handler.handleSlashCommand(f.interaction);
  f.guild.members.fetchMe.mockResolvedValue({ permissions: { has: () => false } });
  await f.confirm();
  expect(f.userModerationService.banUserById).not.toHaveBeenCalled();
});
