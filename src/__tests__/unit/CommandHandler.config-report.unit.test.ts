import { MessageFlags } from 'discord.js';
import { REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY } from '../../utils/reportIntakeSettings';
import {
  USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../../utils/userReportSettings';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler report config commands (unit)', () => {
  it('handles /config report reason-require', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
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
        getSubcommandGroup: jest.fn().mockReturnValue('report'),
        getSubcommand: jest.fn().mockReturnValue('reason-require'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Report reason required: `yes`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config report external-reports', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
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
        getSubcommandGroup: jest.fn().mockReturnValue('report'),
        getSubcommand: jest.fn().mockReturnValue('external-reports'),
        getString: jest.fn().mockReturnValue('notify_only'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('External reports: `notify_only`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config report intake-confirmed-response', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        [REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY]: 'kick',
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
        getSubcommandGroup: jest.fn().mockReturnValue('report'),
        getSubcommand: jest.fn().mockReturnValue('intake-confirmed-response'),
        getString: jest.fn().mockReturnValue('kick'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY]: 'kick',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Confirmed report intake response: `kick`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config report ai-set-max-images', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        report_ai_max_images: 6,
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
        getSubcommandGroup: jest.fn().mockReturnValue('report'),
        getSubcommand: jest.fn().mockReturnValue('ai-set-max-images'),
        getInteger: jest.fn().mockReturnValue(6),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_ai_max_images: 6,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Max images: `6`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config report ai-set-max-image-mb', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        report_ai_max_image_bytes: 15 * 1024 * 1024,
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
        getSubcommandGroup: jest.fn().mockReturnValue('report'),
        getSubcommand: jest.fn().mockReturnValue('ai-set-max-image-mb'),
        getInteger: jest.fn().mockReturnValue(15),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_ai_max_image_bytes: 15 * 1024 * 1024,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Max image size: `15 MB`'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
