import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupServerRecord } from '@drasil/contracts';
import type { DiscordGuildResources, DiscordGuildSummary } from './discordApi';
import { DiscordApiError } from './discordApi';
import { DISCORD_PERMISSIONS } from './discordPermissions';
import { fetchDiscordBotUser, fetchDiscordGuilds, fetchGuildResources } from './discordApi';
import { SetupDashboardService } from './setupDashboardService';
import type { SetupDataAdapter } from './setupDataAdapter';

vi.mock('./discordApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discordApi')>()),
  fetchDiscordGuilds: vi.fn(),
  fetchDiscordBotUser: vi.fn(),
  fetchGuildResources: vi.fn(),
}));

const guild: DiscordGuildSummary = {
  id: 'guild-1',
  name: 'Test Guild',
  icon: null,
  owner: true,
  permissions: '0',
};

const resources: DiscordGuildResources = {
  botUser: { id: 'bot-1', username: 'Drasil', avatar: null },
  botMember: { roles: ['bot-role'] },
  roles: [
    { id: 'guild-1', name: '@everyone', permissions: '0', position: 0, managed: false },
    { id: 'bot-role', name: 'Drasil', permissions: '0', position: 1, managed: false },
  ],
  channels: [],
};

const inactiveServer: SetupServerRecord = {
  guild_id: 'guild-1',
  case_role_id: null,
  admin_channel_id: null,
  verification_channel_id: null,
  admin_notification_role_id: null,
  heuristic_message_threshold: 5,
  heuristic_message_timeframe_seconds: 60,
  heuristic_suspicious_keywords: [],
  created_at: null,
  updated_at: null,
  updated_by: null,
  settings: {},
  is_active: false,
};

function createAdapter(server: SetupServerRecord | null): SetupDataAdapter {
  return {
    provider: 'postgres',
    listConfiguredGuildIds: vi.fn(async () => new Set<string>()),
    getServer: vi.fn(async () => server),
    updateGuildSetup: vi.fn(),
  };
}

describe('SetupDashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchDiscordBotUser).mockResolvedValue(resources.botUser);
  });

  it('marks inactive server records as needing setup', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);
    vi.mocked(fetchGuildResources).mockResolvedValue(resources);

    const service = new SetupDashboardService(createAdapter(inactiveServer));

    await expect(service.getDashboard('guild-1', 'access-token')).resolves.toMatchObject({
      dashboard: { readiness: 'needs_setup' },
    });
  });

  it('rejects @everyone as the configured case role', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);
    vi.mocked(fetchGuildResources).mockResolvedValue({
      ...resources,
      channels: [
        { id: 'admin-channel-1', name: 'admin', type: 0 },
        { id: 'verification-channel-1', name: 'verification', type: 0 },
      ],
    });
    const service = new SetupDashboardService(
      createAdapter({
        ...inactiveServer,
        is_active: true,
        case_role_id: 'guild-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
      })
    );

    const result = await service.getDashboard('guild-1', 'access-token');

    expect(result.dashboard.readiness).toBe('needs_setup');
    expect(result.dashboard.checklist).toContainEqual(
      expect.objectContaining({
        key: 'case-role',
        status: 'error',
        detail: 'The @everyone role cannot be used as a case role.',
      })
    );
  });

  it('uses live diagnostics for the manageable guild readiness summary', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);
    vi.mocked(fetchGuildResources).mockRejectedValue(new DiscordApiError(404, 'Unknown Guild'));

    const service = new SetupDashboardService(createAdapter(null));

    await expect(service.listManageableGuilds('access-token')).resolves.toEqual([
      expect.objectContaining({ id: 'guild-1', readiness: 'not_installed' }),
    ]);
  });

  it('does not report transient Discord failures as not installed', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);
    vi.mocked(fetchGuildResources).mockRejectedValue(
      new DiscordApiError(429, 'You are being rate limited.')
    );

    const service = new SetupDashboardService(createAdapter(null));

    await expect(service.listManageableGuilds('access-token')).resolves.toEqual([
      expect.objectContaining({ id: 'guild-1', readiness: 'needs_setup' }),
    ]);
  });

  it('loads guild readiness with one bot identity lookup and bounded concurrency', async () => {
    const guilds = Array.from({ length: 7 }, (_, index) => ({
      ...guild,
      id: `guild-${index + 1}`,
      name: `Guild ${index + 1}`,
    }));
    let active = 0;
    let maxActive = 0;
    vi.mocked(fetchDiscordGuilds).mockResolvedValue(guilds);
    vi.mocked(fetchGuildResources).mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return resources;
    });

    const service = new SetupDashboardService(createAdapter(inactiveServer));

    await expect(service.listManageableGuilds('access-token')).resolves.toHaveLength(7);
    expect(fetchDiscordBotUser).toHaveBeenCalledTimes(1);
    expect(fetchGuildResources).toHaveBeenCalledTimes(7);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('checks guild management access without fetching live resources', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);

    const service = new SetupDashboardService(createAdapter(null));

    await expect(service.assertCanManageGuild('guild-1', 'access-token')).resolves.toBe(guild);
    expect(fetchGuildResources).not.toHaveBeenCalled();
  });

  it('uses the injected clock for dashboard check time', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);
    vi.mocked(fetchGuildResources).mockResolvedValue(resources);

    const service = new SetupDashboardService(
      createAdapter(inactiveServer),
      () => new Date('2026-06-08T01:16:02.000Z')
    );

    await expect(service.getDashboard('guild-1', 'access-token')).resolves.toMatchObject({
      dashboard: { checkedAt: '2026-06-08T01:16:02.000Z' },
    });
  });

  it.each([
    { label: 'server owner', owner: true, permissions: 0n, expected: true },
    {
      label: 'Administrator',
      owner: false,
      permissions: DISCORD_PERMISSIONS.Administrator,
      expected: true,
    },
    {
      label: 'Manage Server only',
      owner: false,
      permissions: DISCORD_PERMISSIONS.ManageGuild,
      expected: false,
    },
  ])('sets apply authority for a $label', async ({ owner, permissions, expected }) => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([
      { ...guild, owner, permissions: permissions.toString() },
    ]);
    vi.mocked(fetchGuildResources).mockResolvedValue(resources);

    const service = new SetupDashboardService(createAdapter(inactiveServer));

    await expect(service.getDashboard('guild-1', 'access-token')).resolves.toMatchObject({
      canApplySetup: expected,
    });
  });
});
