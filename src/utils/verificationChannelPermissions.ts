import { PermissionFlagsBits } from 'discord.js';

export const CASE_ROLE_VERIFICATION_ALLOW_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessagesInThreads,
] as const;

export const CASE_ROLE_VERIFICATION_DENY_PERMISSIONS = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
] as const;

export const CASE_ROLE_VERIFICATION_MANAGED_PERMISSION_BITS = [
  ...CASE_ROLE_VERIFICATION_ALLOW_PERMISSIONS,
  ...CASE_ROLE_VERIFICATION_DENY_PERMISSIONS,
].reduce((permissions, permission) => permissions | permission, 0n);
