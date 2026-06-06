import { Guild, GuildMember, PermissionFlagsBits } from 'discord.js';
import type { IConfigService } from '../config/ConfigService';
import { getCaseResponderSettings } from './caseResponderSettings';

const REPORT_INTAKE_STAFF_PERMISSIONS = [
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
] as const;

export async function canModerateReportIntake(
  guild: Guild,
  userId: string,
  configService: IConfigService
): Promise<boolean> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return false;
  }

  if (REPORT_INTAKE_STAFF_PERMISSIONS.some((permission) => member.permissions.has(permission))) {
    return true;
  }

  const serverConfig = await configService.getServerConfig(guild.id).catch((error) => {
    console.warn(`Failed to load report intake staff settings for guild ${guild.id}:`, error);
    return null;
  });
  if (!serverConfig) {
    return false;
  }

  const responderSettings = getCaseResponderSettings(serverConfig.settings);
  return responderSettings.roleIds.some((roleId) => memberHasRole(member, roleId));
}

function memberHasRole(member: GuildMember, roleId: string): boolean {
  const roles = member.roles as GuildMember['roles'] | undefined;
  return roles?.cache.has(roleId) ?? false;
}
