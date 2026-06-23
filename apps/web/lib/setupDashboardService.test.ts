import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupServerRecord } from '@drasil/contracts';
import type { DiscordGuildResources, DiscordGuildSummary } from './discordApi';
import { fetchDiscordGuilds, fetchGuildResources } from './discordApi';
import { SetupDashboardService } from './setupDashboardService';
import type { SetupDataAdapter } from './setupDataAdapter';

vi.mock('./discordApi', () => ({
  fetchDiscordGuilds: vi.fn(),
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
  });

  it('does not mark inactive server records as configured', async () => {
    vi.mocked(fetchDiscordGuilds).mockResolvedValue([guild]);
    vi.mocked(fetchGuildResources).mockResolvedValue(resources);

    const service = new SetupDashboardService(createAdapter(inactiveServer));

    await expect(service.getDashboard('guild-1', 'access-token')).resolves.toMatchObject({
      dashboard: { configured: false },
    });
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
});
