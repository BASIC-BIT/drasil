import { PermissionFlagsBits } from 'discord.js';

export const STANDARD_QUARANTINE_PRIVILEGED_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
] as const;

export const COMPROMISED_ACCOUNT_PRIVILEGED_ROLE_PERMISSIONS = [
  ...STANDARD_QUARANTINE_PRIVILEGED_ROLE_PERMISSIONS,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ManageNicknames,
] as const;
