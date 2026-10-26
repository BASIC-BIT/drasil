import { mock } from 'jest-mock-extended';
import {
  ActionRow,
  ComponentType,
  MessageFlagsBitField,
  type ButtonComponent,
  type Message,
  type InteractionCallbackResponse,
  type InteractionResponse,
  ButtonInteraction,
  ModalSubmitInteraction,
  MessageFlags,
} from 'discord.js';
import type { BotCaptchaImageActions } from '../../application/adapters/captchaImage';
import { handleCaptchaImageInteraction } from '../../controllers/captchaImageInteractions';

const challengeId = '00000000-0000-4000-8000-000000000001';
const id = (action: string) => `captcha:image:${action}:${challengeId}:1`;
function fixture(action = 'open', modal = false) {
  const interaction = mock<ButtonInteraction>();
  const fields = mock<ModalSubmitInteraction['fields']>();
  Object.assign(interaction, {
    customId: id(action),
    id: 'discord-interaction',
    guildId: 'guild',
    user: { id: 'member' },
    deferred: false,
    replied: false,
    fields,
  });
  interaction.isModalSubmit.mockReturnValue(modal);
  interaction.deferReply.mockImplementation(async () => {
    Object.assign(interaction, { deferred: true });
    return undefined as never;
  });
  const actions = mock<BotCaptchaImageActions>();
  actions.open.mockResolvedValue({
    kind: 'outcome',
    outcome: { kind: 'ready', png: Buffer.from('private-png') },
  });
  actions.submit.mockResolvedValue({ kind: 'outcome', outcome: { kind: 'passed' } });
  actions.requestAssistance.mockResolvedValue({ kind: 'outcome', outcome: { kind: 'queued' } });
  return { interaction, actions, fields };
}
function rendered(value: unknown): string {
  return JSON.stringify(value);
}

function imageModalFixture() {
  const { actions, fields } = fixture('answer', true);
  const interaction = mock<ModalSubmitInteraction>();
  const message = mock<Message>();
  Object.assign(message, {
    author: { id: 'bot' },
    flags: new MessageFlagsBitField(MessageFlags.Ephemeral),
    components: [
      mock<ActionRow<ButtonComponent>>({
        type: ComponentType.ActionRow,
        components: [
          mock<ButtonComponent>({
            type: ComponentType.Button,
            customId: id('answer'),
            label: 'Enter code',
          }),
        ],
      }),
    ],
  });
  Object.assign(interaction, {
    customId: id('answer'),
    id: 'modal-interaction',
    guildId: 'guild',
    user: { id: 'member' },
    client: { user: { id: 'bot' } },
    message,
    fields,
    deferred: false,
    replied: false,
  });
  interaction.isModalSubmit.mockReturnValue(true);
  interaction.isFromMessage.mockReturnValue(true);
  const acknowledgement = mock<InteractionCallbackResponse & InteractionResponse & Message>();
  interaction.deferUpdate.mockImplementation(async () => {
    Object.assign(interaction, { deferred: true });
    return acknowledgement;
  });
  interaction.deferReply.mockImplementation(async () => {
    Object.assign(interaction, { deferred: true });
    return acknowledgement;
  });
  fields.getTextInputValue.mockReturnValue('AB2CDE');
  return { interaction, actions, fields, message };
}

describe('private Discord image CAPTCHA interactions', () => {
  it('replaces the original private image with acceptance instead of adding another reply', async () => {
    const f = imageModalFixture();
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: 'Code accepted.',
      files: [],
      attachments: [],
      components: [],
    });
    expect(f.interaction.reply).not.toHaveBeenCalled();
    expect(f.interaction.followUp).not.toHaveBeenCalled();
    expect(f.actions.submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'invalid', remainingAttempts: 2 },
    { kind: 'rate_limited' },
    { kind: 'unavailable' },
  ] as const)('keeps the image and answer controls for $kind', async (outcome) => {
    const f = imageModalFixture();
    f.actions.submit.mockResolvedValue({ kind: 'outcome', outcome });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    const payload = f.interaction.editReply.mock.calls[0][0];
    expect(payload).not.toHaveProperty('attachments');
    expect(payload).not.toHaveProperty('files');
    expect(rendered(payload)).toContain(id('answer'));
    expect(rendered(payload)).toContain(id('help'));
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });

  it.each(['failed', 'stale'] as const)(
    'removes the image and controls after $kind',
    async (kind) => {
      const f = imageModalFixture();
      f.actions.submit.mockResolvedValue({ kind: 'outcome', outcome: { kind } });
      await handleCaptchaImageInteraction(f.interaction, f.actions);
      expect(f.interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(f.interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: [], components: [] })
      );
    }
  );

  it('leaves a public source message untouched', async () => {
    const f = imageModalFixture();
    Object.assign(f.message, { flags: new MessageFlagsBitField() });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.interaction.deferUpdate).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it.each(['other_bot', 'other_generation'] as const)(
    'leaves a private source from %s untouched',
    async (source) => {
      const f = imageModalFixture();
      if (source === 'other_bot') Object.assign(f.message, { author: { id: 'other-bot' } });
      else
        Object.assign(f.message, {
          components: [
            mock<ActionRow<ButtonComponent>>({
              type: ComponentType.ActionRow,
              components: [
                mock<ButtonComponent>({
                  type: ComponentType.Button,
                  customId: `captcha:image:answer:${challengeId}:2`,
                }),
              ],
            }),
          ],
        });
      await handleCaptchaImageInteraction(f.interaction, f.actions);
      expect(f.interaction.deferUpdate).not.toHaveBeenCalled();
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    }
  );

  it('does not edit the image for an unauthorized submission', async () => {
    const f = imageModalFixture();
    f.actions.submit.mockResolvedValue({ kind: 'denied', code: 'binding_mismatch' });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  it('keeps an accepted result when Discord cannot update the old image', async () => {
    const f = imageModalFixture();
    f.interaction.editReply.mockRejectedValueOnce(new Error('Discord unavailable'));
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.actions.submit).toHaveBeenCalledTimes(1);
    expect(f.interaction.editReply).toHaveBeenCalledTimes(1);
    expect(f.interaction.followUp).toHaveBeenCalledWith({
      content: 'Code accepted.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('leaves a denied source untouched even when its private notice cannot be delivered', async () => {
    const f = imageModalFixture();
    f.actions.submit.mockResolvedValue({ kind: 'denied', code: 'binding_mismatch' });
    f.interaction.followUp.mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(handleCaptchaImageInteraction(f.interaction, f.actions)).resolves.toBe(true);
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
  it('ignores unrelated controls', async () => {
    const f = fixture();
    Object.assign(f.interaction, { customId: 'verify:member' });
    expect(await handleCaptchaImageInteraction(f.interaction, f.actions)).toBe(false);
    expect(f.interaction.reply).not.toHaveBeenCalled();
  });
  it('opens a private PNG with generic metadata and only answer/help controls', async () => {
    const f = fixture();
    expect(await handleCaptchaImageInteraction(f.interaction, f.actions)).toBe(true);
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.actions.open).toHaveBeenCalledWith(
      {
        guildId: 'guild',
        requestId: 'discord-interaction',
        source: 'discord_interaction',
        actor: { kind: 'user', userId: 'member' },
      },
      { challengeId, generation: 1 }
    );
    const response = f.interaction.editReply.mock.calls[0][0];
    const json = rendered(response);
    expect(json).toContain('captcha.png');
    expect(json).toContain('CAPTCHA image');
    expect(json).toContain(id('answer'));
    expect(json).toContain(id('help'));
    expect(json).toContain('Enter code');
    expect(json).toContain('Get help');
    for (const forbidden of ['Refresh', 'https:', 'Turnstile', 'Select method', 'digest', 'secret'])
      expect(json).not.toContain(forbidden);
  });
  it('shows a 32-character answer modal immediately without fetching or deferring', async () => {
    const f = fixture('answer');
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    const json = rendered(f.interaction.showModal.mock.calls[0][0]);
    expect(json).toContain(id('answer'));
    expect(json).toContain('"max_length":32');
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
    expect(f.actions.open).not.toHaveBeenCalled();
  });
  it('submits the raw answer under the authenticated interaction ID and reports check completion', async () => {
    const f = fixture('answer', true);
    f.fields.getTextInputValue.mockReturnValue(' ab2cde ');
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.actions.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'discord-interaction',
        actor: { kind: 'user', userId: 'member' },
      }),
      { challengeId, generation: 1, interactionId: 'discord-interaction', answer: ' ab2cde ' }
    );
    const json = rendered(f.interaction.editReply.mock.calls[0][0]);
    expect(json).toContain('Code accepted');
    expect(json.toLowerCase()).not.toContain('you are verified');
  });
  it.each([
    'captcha:image:open:bad:1',
    id('refresh'),
    `${id('open')}:extra`,
    `captcha:image:open:${challengeId}:0`,
    `captcha:image:open:${challengeId}:01`,
    `captcha:image:open:${challengeId}:9007199254740992`,
    `captcha:image:${'x'.repeat(100)}`,
  ])('rejects malformed control %s without calling actions', async (customId) => {
    const f = fixture();
    Object.assign(f.interaction, { customId });
    expect(await handleCaptchaImageInteraction(f.interaction, f.actions)).toBe(true);
    expect(f.actions.open).not.toHaveBeenCalled();
    expect(f.actions.submit).not.toHaveBeenCalled();
    expect(f.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });
  it('rejects controls outside a server', async () => {
    const f = fixture();
    Object.assign(f.interaction, { guildId: null });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.actions.open).not.toHaveBeenCalled();
  });
  it.each(['denied', 'stale'] as const)('never sends a PNG for %s authorization', async (kind) => {
    const f = fixture();
    f.actions.open.mockResolvedValue({ kind: 'outcome', outcome: { kind } });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(rendered(f.interaction.editReply.mock.calls)).not.toContain('private-png');
    expect(f.actions.submit).not.toHaveBeenCalled();
  });
  it('offers help when rendering is unavailable', async () => {
    const f = fixture();
    f.actions.open.mockResolvedValue({ kind: 'outcome', outcome: { kind: 'unavailable' } });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    const json = rendered(f.interaction.editReply.mock.calls[0][0]);
    expect(json).toContain('Try opening');
    expect(json).toContain(id('help'));
  });
  it('routes repeated help clicks to the durable assistance action without opening an image', async () => {
    const f = fixture('help');
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    Object.assign(f.interaction, { id: 'second-help-click', deferred: false });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.actions.requestAssistance).toHaveBeenCalledTimes(2);
    expect(f.actions.open).not.toHaveBeenCalled();
    expect(f.actions.submit).not.toHaveBeenCalled();
  });
  it('does not call actions when a deleted thread prevents deferring', async () => {
    const f = fixture();
    f.interaction.deferReply.mockRejectedValue(new Error('Unknown channel'));
    await expect(handleCaptchaImageInteraction(f.interaction, f.actions)).resolves.toBe(true);
    expect(f.actions.open).not.toHaveBeenCalled();
    expect(f.actions.submit).not.toHaveBeenCalled();
  });
  it('contains Discord delivery errors and offers help without submitting', async () => {
    const f = fixture();
    f.interaction.editReply.mockRejectedValueOnce(new Error('delivery failed'));
    await expect(handleCaptchaImageInteraction(f.interaction, f.actions)).resolves.toBe(true);
    expect(f.actions.submit).not.toHaveBeenCalled();
    expect(rendered(f.interaction.editReply.mock.calls[1][0])).toContain(id('help'));
  });
  it('never attaches an image to an interaction acknowledged elsewhere', async () => {
    const f = fixture();
    Object.assign(f.interaction, { deferred: true });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.actions.open).not.toHaveBeenCalled();
    expect(rendered(f.interaction.editReply.mock.calls)).not.toContain('captcha.png');
  });

  it('does not attempt a modal after the interaction has been deferred', async () => {
    const f = fixture('answer');
    Object.assign(f.interaction, { deferred: true });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(f.interaction.showModal).not.toHaveBeenCalled();
  });
  it.each([
    [{ kind: 'invalid', remainingAttempts: 3 }, '3 attempts left'],
    [{ kind: 'failed' }, 'moderator'],
    [{ kind: 'stale' }, 'moderator'],
    [{ kind: 'rate_limited' }, 'try again'],
  ] as const)('presents %s accurately', async (outcome, copy) => {
    const f = fixture('answer', true);
    f.fields.getTextInputValue.mockReturnValue('wrong');
    f.actions.submit.mockResolvedValue({ kind: 'outcome', outcome });
    await handleCaptchaImageInteraction(f.interaction, f.actions);
    expect(rendered(f.interaction.editReply.mock.calls)).toContain(copy);
  });
});
