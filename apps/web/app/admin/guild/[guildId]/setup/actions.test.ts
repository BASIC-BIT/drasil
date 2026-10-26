import * as setupData from '@/lib/setupDataAdapter';
import { FixtureSetupDataAdapter } from '@/e2e/legacy/setupDataAdapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  assertCanManageGuild: vi.fn(),
  queue: vi.fn(),
}));

vi.mock('@/lib/application/adapters/authority', () => ({
  createWebAuthority: () => ({
    loadFresh: async (guildId: string, userId: string) =>
      userId === 'fixture-admin'
        ? { guildId, userId, present: true, owner: true, permissions: '8', roleIds: [] }
        : null,
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: mocks.session,
  getCurrentDiscordToken: mocks.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: mocks.assertCanManageGuild }),
}));
vi.mock('@/lib/setupArtifactActionQueue', () => ({
  queueReportInstructionsRepairRequest: mocks.queue,
}));

import {
  saveGuildSetup,
  queueReportInstructionsRepair,
  queueReportInstructionsRepost,
} from './actions';

vi.spyOn(setupData, 'createSetupDataAdapter').mockImplementation(
  () => new FixtureSetupDataAdapter()
);

describe('report panel setup actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: 'admin' });
    mocks.token.mockResolvedValue({ accessToken: 'token' });
    mocks.assertCanManageGuild.mockResolvedValue({ owner: true, permissions: '0' });
    mocks.queue.mockResolvedValue({ id: 'request', status: 'queued' });
  });

  it.each([false, true])('passes explicit repost=%s with the rendered panel ID', async (repost) => {
    const data = new FormData();
    data.set('reportInstructionsChannelId', 'channel');
    data.set('reportInstructionsMessageId', 'old-panel');
    data.set('reportInstructionsExpectedChannelId', 'original-channel');
    data.set('reportInstructionsSubmissionId', 'submission-1');
    await (repost ? queueReportInstructionsRepost : queueReportInstructionsRepair)('guild', data);
    expect(mocks.queue).toHaveBeenCalledWith({
      context: {
        guildId: 'guild',
        source: 'web',
        requestId: 'submission-1',
        actor: { kind: 'user', userId: 'admin' },
      },
      channelId: 'channel',
      repost,
      expectedMessageId: 'old-panel',
      expectedChannelId: 'original-channel',
      submissionId: 'submission-1',
    });
  });

  it('retains administrator authorization for reposts', async () => {
    mocks.assertCanManageGuild.mockResolvedValue({ owner: false, permissions: '0' });
    const data = new FormData();
    data.set('reportInstructionsChannelId', 'channel');
    await expect(queueReportInstructionsRepost('guild', data)).rejects.toThrow('Administrator');
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});

it('saves the actual fixture setup form without live authority requests', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'true');
  mocks.session.mockResolvedValue({ userId: 'fixture-admin' });
  mocks.token.mockResolvedValue({ accessToken: 'fixture-token' });
  mocks.assertCanManageGuild.mockResolvedValue({ owner: true, permissions: '32' });
  const fetch = vi.fn(() => {
    throw new Error('Unexpected live Discord request');
  });
  vi.stubGlobal('fetch', fetch);
  const form = new FormData();
  form.set('heuristicMessageThreshold', '17');
  await saveGuildSetup('guild-1', form);
  const { fixtureServerRecord } = await import('@/lib/e2eFixtures');
  expect(fixtureServerRecord().heuristic_message_threshold).toBe(17);
  expect(fixtureServerRecord().updated_by).toBe('fixture-admin');
  expect(fetch).not.toHaveBeenCalled();
});

afterEach(async () => {
  const { resetFixtureServerRecord } = await import('@/lib/e2eFixtures');
  resetFixtureServerRecord();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(['none', 'discord_image', 'turnstile'])(
  'maps the administrator method choice %s',
  async (method) => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'true');
    vi.stubEnv('DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET', Buffer.alloc(32, 1).toString('base64'));
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-site');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
    vi.stubEnv('DRASIL_CAPTCHA_BINDING_SECRET', 'test-binding');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'example.test');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test');
    mocks.session.mockResolvedValue({ userId: 'fixture-admin' });
    mocks.token.mockResolvedValue({ accessToken: 'fixture-token' });
    const form = new FormData();
    form.set('captchaMethod', method);
    await saveGuildSetup('guild-1', form);
    const { fixtureServerRecord } = await import('@/lib/e2eFixtures');
    expect(fixtureServerRecord().settings.captcha_method).toBe(method);
  }
);

it('rejects a member method selection before saving', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'true');
  mocks.session.mockResolvedValue({ userId: 'member' });
  mocks.token.mockResolvedValue({ accessToken: 'fixture-token' });
  const form = new FormData();
  form.set('captchaMethod', 'none');
  await expect(saveGuildSetup('guild-1', form)).rejects.toThrow(/actor_unavailable|Administrator/);
});
