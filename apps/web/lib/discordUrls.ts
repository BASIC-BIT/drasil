export function discordMessageUrl(
  guildId: string,
  channelId: string,
  messageId?: string | null
): string {
  return ['https://discord.com/channels', guildId, channelId, messageId]
    .filter((part): part is string => Boolean(part))
    .join('/');
}
