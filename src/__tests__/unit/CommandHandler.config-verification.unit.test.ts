import { MessageFlags } from 'discord.js';
import {
  EXPECTED_TOPICS_SETTING_KEY,
  SERVER_ABOUT_SETTING_KEY,
  VERIFICATION_CONTEXT_SETTING_KEY,
} from '../../utils/serverContextSettings';
import { VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY } from '../../utils/verificationPromptTemplate';
import {
  VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY,
  VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY,
} from '../../utils/verificationThreadAnalysisSettings';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler verification config commands (unit)', () => {
  it('handles /config verification prompt-set with escaped newlines', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('prompt-set'),
        getString: jest.fn().mockReturnValue('Welcome {user_mention}\\nIn {server_name}'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      verification_prompt_template: 'Welcome {user_mention}\nIn {server_name}',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated verification prompt template'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('does not rethrow if an analytics command reply failure also prevents the error reply', async () => {
    const { handler } = buildHandler();
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      replied: false,
      deferred: false,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('analytics'),
        getSubcommand: jest.fn().mockReturnValue('view'),
      },
      reply: jest.fn().mockRejectedValue(new Error('reply failed')),
      followUp: jest.fn().mockResolvedValue(undefined),
    } as any;

    try {
      await expect(handler.handleSlashCommand(interaction)).resolves.toBeUndefined();

      expect(interaction.reply).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to send analytics settings error response:',
        expect.any(Error)
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('handles /config verification prompt-view', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY]: 'Welcome {user_mention}',
      },
    });
    const { handler, configService } = buildHandler({ getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('prompt-view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Verification prompt template (custom):'),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Welcome {user_mention}'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification prompt-reset', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY]: 'custom',
        auto_restrict: true,
      },
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('prompt-reset'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      settings: {
        auto_restrict: true,
      },
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Reset verification prompt template to default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification context-set', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        server_about: 'A speedrunning guild',
        verification_context: 'Legitimate members often mention splits',
        expected_topics: ['doom', 'quake'],
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-set'),
        getString: jest.fn((name: string) => {
          if (name === 'server-about') return 'A speedrunning guild';
          if (name === 'verification-context') return 'Legitimate members often mention splits';
          if (name === 'expected-topics') return 'doom, quake';
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [SERVER_ABOUT_SETTING_KEY]: 'A speedrunning guild',
      [VERIFICATION_CONTEXT_SETTING_KEY]: 'Legitimate members often mention splits',
      [EXPECTED_TOPICS_SETTING_KEY]: ['doom', 'quake'],
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated AI server context'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config verification context-view and truncates oversized previews', async () => {
    const longLine = 'A'.repeat(1200);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [SERVER_ABOUT_SETTING_KEY]: `${longLine}\n${longLine}`,
        [VERIFICATION_CONTEXT_SETTING_KEY]: `${longLine}\n${longLine}`,
        [EXPECTED_TOPICS_SETTING_KEY]: ['doom', 'quake'],
      },
    });
    const { handler } = buildHandler({ getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    const reply = interaction.reply.mock.calls[0][0];
    expect(reply.content).toContain('Current AI server context');
    expect(reply.content).toContain('... (truncated ');
    expect(reply.content.length).toBeLessThanOrEqual(2000);
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    expect(reply.allowedMentions).toEqual({ parse: [] });
  });

  it('rejects /config verification context-set with no values', async () => {
    const { handler, configService } = buildHandler();

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-set'),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Provide at least one server context field to update.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects /config verification context-set when expected-topics contains only delimiters', async () => {
    const { handler, configService } = buildHandler();

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-set'),
        getString: jest.fn((name: string) => {
          if (name === 'expected-topics') return ',,\n,  ,';
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Provide at least one server context field to update.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification context-reset', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [SERVER_ABOUT_SETTING_KEY]: 'old about',
        [VERIFICATION_CONTEXT_SETTING_KEY]: 'old context',
        [EXPECTED_TOPICS_SETTING_KEY]: ['doom'],
        auto_restrict: true,
      },
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-reset'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      settings: {
        auto_restrict: true,
      },
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '✅ Reset AI server context to defaults.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-enable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: true,
        verification_ai_thread_analysis_message_limit: 3,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-enable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY]: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Enabled verification reply AI analysis'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-view', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: true,
        verification_ai_thread_analysis_message_limit: 4,
      },
    });
    const { handler, configService } = buildHandler({ getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Verification reply AI analysis settings'),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Enabled: `yes`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-disable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: false,
        verification_ai_thread_analysis_message_limit: 3,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY]: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Disabled verification reply AI analysis'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-set-limit', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: true,
        verification_ai_thread_analysis_message_limit: 5,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-set-limit'),
        getInteger: jest.fn().mockReturnValue(5),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY]: 5,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated verification reply AI analysis message limit'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
