import {
  decodeVerificationPromptTemplateInput,
  DISCORD_MESSAGE_CONTENT_MAX_LENGTH,
  enforceDiscordMessageLimit,
  resolveVerificationPromptTemplate,
  renderVerificationPromptTemplate,
} from '../../utils/verificationPromptTemplate';

describe('verificationPromptTemplate (unit)', () => {
  it('decodes escaped newlines and trims input', () => {
    expect(decodeVerificationPromptTemplateInput('  Line 1\\nLine 2  ')).toBe('Line 1\nLine 2');
  });

  it('renders placeholders and sanitizes server mention-like text', () => {
    const rendered = renderVerificationPromptTemplate('Hello {user_mention} to {server_name}.', {
      userMention: '<@123>',
      serverName: 'My @everyone Server',
    });

    expect(rendered).toBe('Hello <@123> to My @\u200beveryone Server.');
  });

  it('resolves to default template when custom value is blank', () => {
    const resolved = resolveVerificationPromptTemplate('   ');
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved).toContain('{user_mention}');
  });

  it('enforces Discord message length limit with truncation notice', () => {
    const overLimit = 'x'.repeat(DISCORD_MESSAGE_CONTENT_MAX_LENGTH + 100);
    const constrained = enforceDiscordMessageLimit(overLimit);

    expect(constrained.length).toBeLessThanOrEqual(DISCORD_MESSAGE_CONTENT_MAX_LENGTH);
    expect(constrained).toContain('[Verification prompt truncated to fit Discord message limits.]');
  });
});
