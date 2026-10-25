import type { ActionResult, DetectionOutcome, SetupOutcome } from '@drasil/application';
import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  Role,
  TextChannel,
  User,
} from 'discord.js';
import { mockDeep } from 'jest-mock-extended';
import type { BotApplication } from '../../application/createBotApplication';
import type { IConfigService } from '../../config/ConfigService';
import { ModerationCommandHandler } from '../../controllers/ModerationCommandHandler';
import { SetupVerificationModalHandler } from '../../controllers/SetupVerificationModalHandler';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import type { ISetupDiagnosticsService } from '../../services/SetupDiagnosticsService';
import {
  SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID,
} from '../../constants/setupVerificationWizard';
import { handleSlashCommandConfirmationButton } from '../../utils/slashCommandConfirmations';

function heldPromise<T>() {
  // eslint-disable-next-line no-unused-vars -- This parameter belongs to a function type.
  let resolve!: (value: T) => void;
  // eslint-disable-next-line no-unused-vars -- This parameter belongs to a function type.
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const roleId = '123456789012345678';
const adminChannelId = '123456789012345679';
const verificationChannelId = '123456789012345680';
const report = {
  guildId: 'guild-1',
  checkedAt: new Date('2026-01-01T00:00:00Z'),
  issues: [{ severity: 'error' as const, code: 'permissions', message: 'Missing Send Messages.' }],
  errorCount: 1,
  warningCount: 0,
};
const setupFailure =
  'Failed to complete setup verification. Please check permissions and try again.';

const setupResponses: { name: string; result: ActionResult<SetupOutcome>; content: string }[] = [
  {
    name: 'success',
    result: {
      kind: 'outcome',
      outcome: {
        kind: 'complete_setup_verification',
        result: {
          status: 'completed',
          candidateReport: report,
          caseRoleWasCreated: false,
          caseRoleId: roleId,
          adminChannelId,
          verificationChannelId,
          verificationChannelAction: 'configured',
        },
      },
    },
    content: `Setup complete.\nCase role: <@&${roleId}>\nAdmin channel: <#${adminChannelId}>\nVerification channel: <#${verificationChannelId}>`,
  },
  ...(['candidate_validation_failed', 'final_validation_failed'] as const).map((status) => ({
    name: status,
    result: {
      kind: 'outcome' as const,
      outcome: {
        kind: 'complete_setup_verification' as const,
        result: { status, report, setupFailureDetail: 'Please try again.' },
      },
    },
    content: 'Setup not saved. Fix these errors before completing setup:\n- Missing Send Messages.',
  })),
  {
    name: 'fresh authority denial',
    result: { kind: 'denied', code: 'permission_denied' },
    content: setupFailure,
  },
];

function setupFixture() {
  const application = mockDeep<BotApplication>();
  const client = mockDeep<Client>();
  const guild = Object.assign(mockDeep<Guild>(), { id: 'guild-1' });
  const moderator = mockDeep<GuildMember>();
  moderator.permissions.has.mockReturnValue(true);
  Object.assign(guild.members, { fetch: jest.fn(async () => moderator) });
  Object.assign(guild.roles, {
    fetch: jest.fn(async () => Object.assign(mockDeep<Role>(), { id: roleId })),
  });
  Object.assign(guild.channels, {
    fetch: jest.fn(async () =>
      Object.assign(mockDeep<TextChannel>(), { type: ChannelType.GuildText })
    ),
  });
  Object.assign(client.guilds, { fetch: jest.fn(async () => guild) });
  const interaction = Object.assign(mockDeep<ModalSubmitInteraction>(), {
    guildId: guild.id,
    deferred: false,
    replied: false,
    user: Object.assign(mockDeep<User>(), { id: 'actor-1', username: 'actor' }),
  });
  interaction.fields.getTextInputValue.mockImplementation((id) => {
    if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) return roleId;
    if (id === SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID) return adminChannelId;
    return '';
  });
  Object.assign(interaction, {
    deferReply: jest.fn(async () => {
      interaction.deferred = true;
      return undefined;
    }),
  });
  return {
    application,
    client,
    interaction,
    handler: new SetupVerificationModalHandler(
      client,
      mockDeep<ISetupDiagnosticsService>(),
      application
    ),
  };
}

describe('setup modal acknowledgement', () => {
  it.each(setupResponses)(
    'acknowledges before pending application work and edits $name',
    async ({ result, content }) => {
      const f = setupFixture();
      const pending = heldPromise<ActionResult<SetupOutcome>>();
      const started = heldPromise<void>();
      f.application.setupRuntime.execute.mockImplementation(() => {
        started.resolve();
        return pending.promise;
      });
      const handling = f.handler.handleSetupVerificationModalSubmit(f.interaction);
      await started.promise;
      try {
        expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(f.interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
          f.client.guilds.fetch.mock.invocationCallOrder[0]
        );
        expect(f.interaction.reply).not.toHaveBeenCalled();
        expect(f.interaction.editReply).not.toHaveBeenCalled();
      } finally {
        pending.resolve(result);
        await handling;
      }
      expect(f.interaction.editReply).toHaveBeenCalledWith(
        result.kind === 'outcome' ? { content, allowedMentions: { parse: [] } } : { content }
      );
      expect(f.interaction.followUp).not.toHaveBeenCalled();
      expect(f.interaction.reply).not.toHaveBeenCalled();
    }
  );

  it('resolves the original deferred reply when application work rejects', async () => {
    const f = setupFixture();
    const pending = heldPromise<ActionResult<SetupOutcome>>();
    const started = heldPromise<void>();
    f.application.setupRuntime.execute.mockImplementation(() => {
      started.resolve();
      return pending.promise;
    });
    const handling = f.handler.handleSetupVerificationModalSubmit(f.interaction);
    await started.promise;
    try {
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.interaction.editReply).not.toHaveBeenCalled();
    } finally {
      pending.reject(new Error('Fresh configuration unavailable'));
      await handling;
    }
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.interaction.editReply).toHaveBeenCalledWith({ content: setupFailure });
    expect(f.interaction.followUp).not.toHaveBeenCalled();
    expect(f.interaction.reply).not.toHaveBeenCalled();
  });
});

describe('report-ban review acknowledgement', () => {
  function fixture() {
    const application = mockDeep<BotApplication>();
    const interaction = Object.assign(mockDeep<ChatInputCommandInteraction>(), {
      id: 'slash-1',
      deferred: false,
      replied: false,
      guild: Object.assign(mockDeep<Guild>(), { id: 'guild-1' }),
      guildId: 'guild-1',
      user: Object.assign(mockDeep<User>(), { id: 'actor-1' }),
    });
    interaction.options.getString.mockImplementation((name) =>
      name === 'operation' ? 'operation-1' : 'Reviewed audit trail'
    );
    Object.assign(interaction, {
      deferReply: jest.fn(async () => {
        interaction.deferred = true;
        return undefined;
      }),
    });
    const handler = new ModerationCommandHandler(
      mockDeep<IConfigService>(),
      mockDeep<ISecurityActionService>(),
      jest.fn(),
      undefined,
      undefined,
      application
    );
    return { application, interaction, handler };
  }

  it('acknowledges pending preparation and edits the original reply with the existing confirmation', async () => {
    const f = fixture();
    const pending = heldPromise<ActionResult<DetectionOutcome>>();
    const started = heldPromise<void>();
    f.application.detections.execute.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const handling = f.handler.handleReviewReportBanCommand(f.interaction);
    await started.promise;
    const reference = {
      operationId: 'operation-1',
      attemptToken: 'attempt-1',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      targetUserId: 'target-1',
      reviewReference: 'private-review-reference',
    };
    try {
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
        f.application.detections.execute.mock.invocationCallOrder[0]
      );
      expect(f.interaction.reply).not.toHaveBeenCalled();
      expect(f.interaction.editReply).not.toHaveBeenCalled();
    } finally {
      pending.resolve({
        kind: 'outcome',
        outcome: { kind: 'prepare_report_ban_review', reference },
      });
      await handling;
    }
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'Review operation operation-1 for user target-1? If no current ban exists, release its claims. The historical outcome remains uncertain. This does not ban or unban anyone. Reason: Reviewed audit trail',
        allowedMentions: { parse: [] },
      })
    );
    expect(f.interaction.reply).not.toHaveBeenCalled();
    const response = f.interaction.editReply.mock.calls[0][0];
    if (typeof response !== 'object' || !('components' in response) || !response.components)
      throw new Error('Expected confirmation buttons');
    const row = response.components[0];
    if (!(row instanceof ActionRowBuilder)) throw new Error('Expected confirmation row');
    const confirm = row.components[0];
    if (!(confirm instanceof ButtonBuilder) || !('custom_id' in confirm.data))
      throw new Error('Expected confirmation custom ID');
    const button = Object.assign(mockDeep<ButtonInteraction>(), {
      id: 'button-1',
      user: f.interaction.user,
      guildId: f.interaction.guildId,
      customId: confirm.data.custom_id,
    });
    f.application.detections.execute.mockResolvedValue({
      kind: 'outcome',
      outcome: { kind: 'review_uncertain_report_ban', succeeded: true },
    });
    await handleSlashCommandConfirmationButton(button);
    expect(f.application.caseConfirmations.recordVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'button-1',
        guildId: 'guild-1',
        source: 'discord_interaction',
      }),
      { kind: 'review_uncertain_report_ban', ...reference, reason: 'Reviewed audit trail' }
    );
    expect(button.editReply).toHaveBeenCalledWith({
      content:
        'Review recorded: no current ban, historical outcome uncertain. Matching claims released. Any later ban requires a new explicit action.',
    });
  });

  it.each(['denial', 'error'] as const)(
    'edits pending preparation %s into the original deferred reply',
    async (mode) => {
      const f = fixture();
      const pending = heldPromise<ActionResult<DetectionOutcome>>();
      const started = heldPromise<void>();
      f.application.detections.execute.mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
      const handling = f.handler.handleReviewReportBanCommand(f.interaction);
      await started.promise;
      try {
        expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(f.interaction.editReply).not.toHaveBeenCalled();
      } finally {
        if (mode === 'denial') pending.resolve({ kind: 'denied', code: 'permission_denied' });
        else pending.reject(new Error('Fresh authority unavailable'));
        await handling;
      }
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.interaction.editReply).toHaveBeenCalledWith({
        content:
          mode === 'denial'
            ? 'Detection action denied: permission_denied'
            : 'Fresh authority unavailable',
      });
      expect(f.interaction.reply).not.toHaveBeenCalled();
      expect(f.interaction.followUp).not.toHaveBeenCalled();
    }
  );
});
