import { DISCORD_PERMISSIONS } from './discordPermissions';
import { readOptionalEnv } from './env';

export type BotInviteMode = 'standard' | 'administrator';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

export const STANDARD_BOT_INVITE_PERMISSIONS =
  DISCORD_PERMISSIONS.BanMembers |
  DISCORD_PERMISSIONS.ManageChannels |
  DISCORD_PERMISSIONS.ManageRoles |
  DISCORD_PERMISSIONS.ViewAuditLog |
  DISCORD_PERMISSIONS.ViewChannel |
  DISCORD_PERMISSIONS.SendMessages |
  DISCORD_PERMISSIONS.ManageMessages |
  DISCORD_PERMISSIONS.EmbedLinks |
  DISCORD_PERMISSIONS.ReadMessageHistory |
  DISCORD_PERMISSIONS.MentionEveryone |
  DISCORD_PERMISSIONS.ManageThreads |
  DISCORD_PERMISSIONS.CreatePrivateThreads |
  DISCORD_PERMISSIONS.SendMessagesInThreads;

export function isAdministratorInviteEnabled(): boolean {
  return readOptionalEnv('DRASIL_WEB_ENABLE_ADMINISTRATOR_INVITE') === 'true';
}

export function buildBotInviteUrl(mode: BotInviteMode, guildId?: string): string | null {
  if (mode === 'administrator' && !isAdministratorInviteEnabled()) {
    return null;
  }

  const clientId = readOptionalEnv('DISCORD_CLIENT_ID');
  if (!clientId) {
    return null;
  }

  const permissions =
    mode === 'administrator' ? DISCORD_PERMISSIONS.Administrator : STANDARD_BOT_INVITE_PERMISSIONS;
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', String(permissions));
  if (guildId) {
    url.searchParams.set('guild_id', guildId);
    url.searchParams.set('disable_guild_select', 'true');
  }
  return url.toString();
}
