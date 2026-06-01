import { describe, expect, it } from 'vitest';
import {
  DISCORD_PERMISSIONS,
  canManageGuild,
  computeChannelPermissions,
  computeGuildPermissions,
  hasPermission,
} from './discordPermissions';

describe('discord permission helpers', () => {
  it('allows owners and Manage Guild holders into admin setup', () => {
    expect(canManageGuild('0', true)).toBe(true);
    expect(canManageGuild(String(DISCORD_PERMISSIONS.ManageGuild), false)).toBe(true);
    expect(canManageGuild('0', false)).toBe(false);
  });

  it('treats malformed permission payloads as no permissions', () => {
    expect(canManageGuild('not-a-number', false)).toBe(false);
    expect(canManageGuild(undefined, false)).toBe(false);
  });

  it('applies channel overwrites in Discord order', () => {
    const guildPermissions = computeGuildPermissions({
      guildId: 'guild',
      memberRoleIds: ['role'],
      roles: [
        { id: 'guild', permissions: String(DISCORD_PERMISSIONS.ViewChannel) },
        { id: 'role', permissions: String(DISCORD_PERMISSIONS.SendMessages) },
      ],
    });

    const channelPermissions = computeChannelPermissions({
      guildId: 'guild',
      userId: 'user',
      guildPermissions,
      memberRoleIds: ['role'],
      overwrites: [
        { id: 'guild', type: 0, allow: '0', deny: String(DISCORD_PERMISSIONS.ViewChannel) },
        { id: 'role', type: 0, allow: String(DISCORD_PERMISSIONS.ViewChannel), deny: '0' },
      ],
    });

    expect(hasPermission(channelPermissions, DISCORD_PERMISSIONS.ViewChannel)).toBe(true);
    expect(hasPermission(channelPermissions, DISCORD_PERMISSIONS.SendMessages)).toBe(true);
  });
});
