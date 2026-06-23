interface DiscordUserIdentityUser {
  readonly id?: string;
  readonly username?: string | null;
  readonly tag?: string | null;
  readonly globalName?: string | null;
}

interface DiscordUserIdentitySource {
  readonly id: string;
  readonly displayName?: string | null;
  readonly nickname?: string | null;
  readonly user?: DiscordUserIdentityUser;
  readonly username?: string | null;
  readonly tag?: string | null;
  readonly globalName?: string | null;
}

interface DiscordUserIdentityOptions {
  readonly includeSnowflake?: boolean;
  readonly includeServerNames?: boolean;
}

export function formatDiscordUserMention(userId: string): string {
  return `<@${userId}>`;
}

export function formatInlineIdentifier(value: string): string {
  const normalized = value.trim().replace(/`/g, "'");
  return `\`${normalized}\``;
}

export function formatDiscordUserIdentity(
  source: DiscordUserIdentitySource,
  options: DiscordUserIdentityOptions = {}
): string {
  const user = source.user ?? source;
  const userId = readOptionalString(user.id) ?? source.id;
  const includeSnowflake = options.includeSnowflake ?? true;
  const includeServerNames = options.includeServerNames ?? true;
  const details: string[] = [];

  if (includeSnowflake) {
    details.push(`ID: ${formatInlineIdentifier(userId)}`);
  }

  const username = readOptionalString(user.username) ?? readOptionalString(user.tag);
  if (username) {
    details.push(`Discord username: ${formatInlineIdentifier(username)}`);
  }

  const globalName = readOptionalString(user.globalName);
  if (globalName && globalName !== username) {
    details.push(`Display name: ${formatInlineIdentifier(globalName)}`);
  }

  if (includeServerNames) {
    const nickname = readOptionalString(source.nickname);
    if (nickname && nickname !== username && nickname !== globalName) {
      details.push(`Server nickname: ${formatInlineIdentifier(nickname)}`);
    }
  }

  return details.length
    ? `${formatDiscordUserMention(userId)} (${details.join('; ')})`
    : formatDiscordUserMention(userId);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
