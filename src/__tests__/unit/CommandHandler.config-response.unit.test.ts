import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { AuthorityFacts } from '@drasil/application';
import { buildHandler, configurationResponseMocks } from './commandHandlerTestHarness';

function interactionFor(group: string | null, subcommand: string): ChatInputCommandInteraction {
  return {
    id: 'config-response',
    commandName: 'config',
    user: { id: 'admin' },
    guild: {
      id: 'guild-1',
      members: { fetch: jest.fn(async () => ({ permissions: { has: () => true } })) },
    },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => subcommand,
      getString: (name: string) => (name === 'key' ? 'admin_channel_id' : 'channel'),
    },
    ...configurationResponseMocks(),
    replied: false,
    reply: jest.fn(),
    followUp: jest.fn(),
  } as unknown as ChatInputCommandInteraction;
}

const mutations = [
  ['role-gate', 'enable', 'Enabled role gate handling.'],
  [null, 'set', 'Configuration updated successfully!'],
  ['heuristic', 'reset', 'Reset all heuristic settings to defaults.'],
  ['verification', 'prompt-reset', 'Reset verification prompt template to default.'],
] as const;

test.each(mutations)(
  'acknowledges %s %s before delayed execution authority resolves',
  async (group, subcommand, expected) => {
    let release!: () => void;
    let started!: () => void;
    const authorityStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const authority = new Promise<AuthorityFacts>((resolve) => {
      release = () =>
        resolve({
          guildId: 'guild-1',
          userId: 'admin',
          present: true,
          owner: false,
          permissions: '8',
          roleIds: [],
        });
    });
    const { handler } = buildHandler({
      caseAuthority: {
        loadFresh: async () => {
          started();
          return authority;
        },
      },
    });
    const interaction = interactionFor(group, subcommand);
    const running = handler.handleSlashCommand(interaction);
    await authorityStarted;
    const acknowledgedBeforeRelease = (interaction.deferReply as jest.Mock).mock.calls.length;
    release();
    await running;
    expect(acknowledgedBeforeRelease).toBe(1);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(expected) })
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  }
);

test.each(['denied', 'failed'] as const)(
  'edits the deferred section response when authority is %s',
  async (result) => {
    const { handler, configService } = buildHandler({
      caseAuthority: {
        loadFresh: async () => {
          if (result === 'failed') throw new Error('Authority lookup failed.');
          return {
            guildId: 'guild-1',
            userId: 'admin',
            present: true,
            owner: false,
            permissions: '0',
            roleIds: [],
          };
        },
      },
    });
    const interaction = interactionFor('role-gate', 'enable');
    await handler.handleSlashCommand(interaction);
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: `Failed to process role gate settings: ${result === 'failed' ? 'Authority lookup failed.' : 'Setup requires current Administrator permission.'}`,
    });
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  }
);

test('edits bare set errors after acknowledging', async () => {
  const { handler } = buildHandler({
    updateServerConfig: jest.fn(async () => {
      throw new Error('Storage failed');
    }),
  });
  const interaction = interactionFor(null, 'set');
  await handler.handleSlashCommand(interaction);
  expect(interaction.deferReply).toHaveBeenCalledTimes(1);
  expect(interaction.editReply).toHaveBeenCalledWith({
    content: 'An error occurred while updating the configuration. Please try again later.',
  });
  expect(interaction.reply).not.toHaveBeenCalled();
});

test('keeps readonly configuration views on their existing reply path', async () => {
  const { handler } = buildHandler();
  const interaction = interactionFor('role-gate', 'view');
  await handler.handleSlashCommand(interaction);
  expect(interaction.deferReply).not.toHaveBeenCalled();
  expect(interaction.editReply).not.toHaveBeenCalled();
  expect(interaction.reply).toHaveBeenCalledWith(
    expect.objectContaining({ flags: MessageFlags.Ephemeral })
  );
});
