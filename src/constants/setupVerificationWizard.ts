const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const ROLE_MENTION_PATTERN = /^<@&(\d{17,20})>$/;
const CHANNEL_MENTION_PATTERN = /^<#(\d{17,20})>$/;

export const SETUP_VERIFICATION_MODAL_ID = 'setup_verification_modal_submit';
export const SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID = 'setup_restricted_role_id';
export const SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID = 'setup_admin_channel_id';
export const SETUP_VERIFICATION_CHANNEL_FIELD_ID = 'setup_verification_channel_id';

export function parseRoleId(value: string): string | null {
  const trimmedValue = value.trim();

  if (DISCORD_ID_PATTERN.test(trimmedValue)) {
    return trimmedValue;
  }

  const mentionMatch = trimmedValue.match(ROLE_MENTION_PATTERN);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return null;
}

export function parseChannelId(value: string): string | null {
  const trimmedValue = value.trim();

  if (DISCORD_ID_PATTERN.test(trimmedValue)) {
    return trimmedValue;
  }

  const mentionMatch = trimmedValue.match(CHANNEL_MENTION_PATTERN);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return null;
}
