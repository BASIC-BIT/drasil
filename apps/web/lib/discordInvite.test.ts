import { describe, expect, it, vi } from 'vitest';
import {
  STANDARD_BOT_INVITE_PERMISSIONS,
  buildBotInviteUrl,
  isAdministratorInviteEnabled,
} from './discordInvite';
import { DISCORD_PERMISSIONS } from './discordPermissions';

describe('Discord bot invite helpers', () => {
  it('builds least-privilege bot invite by default', () => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'client-1');
    vi.stubEnv('DRASIL_WEB_ENABLE_ADMINISTRATOR_INVITE', '');

    const invite = buildBotInviteUrl('standard', 'guild-1');
    const url = new URL(invite ?? '');

    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('guild_id')).toBe('guild-1');
    expect(BigInt(url.searchParams.get('permissions') ?? '0')).toBe(
      STANDARD_BOT_INVITE_PERMISSIONS
    );
    expect(
      (STANDARD_BOT_INVITE_PERMISSIONS & DISCORD_PERMISSIONS.Administrator) ===
        DISCORD_PERMISSIONS.Administrator
    ).toBe(false);
  });

  it('keeps administrator invite disabled unless explicitly enabled', () => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'client-1');
    vi.stubEnv('DRASIL_WEB_ENABLE_ADMINISTRATOR_INVITE', '');

    expect(isAdministratorInviteEnabled()).toBe(false);
    expect(buildBotInviteUrl('administrator')).toBeNull();
  });

  it('builds administrator invite only behind the feature flag', () => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'client-1');
    vi.stubEnv('DRASIL_WEB_ENABLE_ADMINISTRATOR_INVITE', 'true');

    const invite = buildBotInviteUrl('administrator');
    const url = new URL(invite ?? '');

    expect(isAdministratorInviteEnabled()).toBe(true);
    expect(BigInt(url.searchParams.get('permissions') ?? '0')).toBe(
      DISCORD_PERMISSIONS.Administrator
    );
  });
});
