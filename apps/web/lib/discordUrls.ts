const discordWebBaseUrl = 'https://discord.com/channels';
const discordDesktopBaseUrl = 'discord://discord.com/channels';

function discordChannelParts(
  guildId: string,
  channelId: string,
  messageId?: string | null
): string[] {
  return [guildId, channelId, messageId].filter((part): part is string => Boolean(part));
}

export function discordMessageUrl(
  guildId: string,
  channelId: string,
  messageId?: string | null
): string {
  return [discordWebBaseUrl, ...discordChannelParts(guildId, channelId, messageId)].join('/');
}

export function discordDesktopUrl(
  guildId: string,
  channelId: string,
  messageId?: string | null
): string {
  return [discordDesktopBaseUrl, ...discordChannelParts(guildId, channelId, messageId)].join('/');
}

export function discordDesktopUrlFromWebUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'discord.com') {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'channels' || !parts[1] || !parts[2]) {
      return null;
    }

    return discordDesktopUrl(parts[1], parts[2], parts[3]);
  } catch {
    return null;
  }
}
