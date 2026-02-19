export const VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY = 'verification_prompt_template';
export const DISCORD_MESSAGE_CONTENT_MAX_LENGTH = 2000;

const VERIFICATION_PROMPT_TRUNCATION_NOTICE =
  '\n\n[Verification prompt truncated to fit Discord message limits.]';

export const DEFAULT_VERIFICATION_PROMPT_TEMPLATE =
  '# Verification for {user_mention}\n\n' +
  'Hello {user_mention}, your account has been automatically flagged for verification.\n\n' +
  'To help us verify your account, please answer these questions:\n\n' +
  '1. How did you find our community?\n' +
  '2. What interests you here?\n\n' +
  'Once you respond, a moderator will review your answers and grant you full access to the server if everything checks out.';

const USER_MENTION_PLACEHOLDER_PATTERN = /\{user_mention\}/gi;
const SERVER_NAME_PLACEHOLDER_PATTERN = /\{server_name\}/gi;

interface VerificationPromptTemplateContext {
  userMention: string;
  serverName: string;
}

function sanitizeServerName(serverName: string): string {
  return serverName.replace(/@/g, '@\u200b');
}

export function decodeVerificationPromptTemplateInput(rawTemplate: string): string {
  return rawTemplate.replace(/\\n/g, '\n').trim();
}

export function renderVerificationPromptTemplate(
  template: string,
  context: VerificationPromptTemplateContext
): string {
  return template
    .replace(USER_MENTION_PLACEHOLDER_PATTERN, context.userMention)
    .replace(SERVER_NAME_PLACEHOLDER_PATTERN, sanitizeServerName(context.serverName));
}

export function resolveVerificationPromptTemplate(
  templateFromSettings: string | null | undefined
): string {
  const template = templateFromSettings?.trim();
  return template ? template : DEFAULT_VERIFICATION_PROMPT_TEMPLATE;
}

export function enforceDiscordMessageLimit(content: string): string {
  if (content.length <= DISCORD_MESSAGE_CONTENT_MAX_LENGTH) {
    return content;
  }

  const maxPrefixLength =
    DISCORD_MESSAGE_CONTENT_MAX_LENGTH - VERIFICATION_PROMPT_TRUNCATION_NOTICE.length;
  if (maxPrefixLength <= 0) {
    return content.slice(0, DISCORD_MESSAGE_CONTENT_MAX_LENGTH);
  }

  return `${content.slice(0, maxPrefixLength)}${VERIFICATION_PROMPT_TRUNCATION_NOTICE}`;
}
