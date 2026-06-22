export const DISCORD_UNKNOWN_CHANNEL_ERROR_CODE = 10003;
export const DISCORD_UNKNOWN_MEMBER_ERROR_CODE = 10007;
export const DISCORD_UNKNOWN_MESSAGE_ERROR_CODE = 10008;
export const DISCORD_UNKNOWN_BAN_ERROR_CODE = 10026;

export function getDiscordErrorCode(error: unknown): number | string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: number | string }).code
    : undefined;
}

export function isDiscordErrorCode(error: unknown, code: number): boolean {
  return getDiscordErrorCode(error) === code;
}

export function isDiscordUnknownBanError(error: unknown): boolean {
  return isDiscordErrorCode(error, DISCORD_UNKNOWN_BAN_ERROR_CODE);
}

export function formatDiscordFetchError(error: unknown, maxLength = 180): string {
  const code = getDiscordErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const detail = code
    ? `Discord fetch failed (${code}): ${message}`
    : `Discord fetch failed: ${message}`;
  return detail.length <= maxLength ? detail : `${detail.slice(0, maxLength - 3)}...`;
}
