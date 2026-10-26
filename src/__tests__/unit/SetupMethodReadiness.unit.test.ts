import { isBotCaptchaMethodConfigured } from '../../services/captcha/readiness';
import { isCaptchaImageRendererReady } from '../../services/captcha/imageRenderer';
jest.mock('../../services/captcha/imageRenderer', () => ({
  isCaptchaImageRendererReady: jest.fn(),
}));
const rendererReady = jest.mocked(isCaptchaImageRendererReady);
const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv };
  for (const key of [
    'DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'DRASIL_CAPTCHA_BINDING_SECRET',
    'TURNSTILE_EXPECTED_HOSTNAME',
    'NEXT_PUBLIC_APP_URL',
    'DRASIL_WEB_PUBLIC_URL',
  ])
    delete process.env[key];
  rendererReady.mockReturnValue(true);
});
afterEach(() => {
  process.env = originalEnv;
});
it('allows image without Turnstile but requires a decoded key and initialized renderer', () => {
  expect(isBotCaptchaMethodConfigured('discord_image')).toBe(false);
  process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET = Buffer.alloc(32, 7).toString('base64');
  expect(isBotCaptchaMethodConfigured('discord_image')).toBe(true);
  rendererReady.mockReturnValue(false);
  expect(isBotCaptchaMethodConfigured('discord_image')).toBe(false);
  rendererReady.mockReturnValue(true);
  process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET = 'invalid';
  expect(isBotCaptchaMethodConfigured('discord_image')).toBe(false);
});
it('requires the Turnstile configuration and public origin independently of image readiness', () => {
  expect(isBotCaptchaMethodConfigured('turnstile')).toBe(false);
  Object.assign(process.env, {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET_KEY: 'secret',
    DRASIL_CAPTCHA_BINDING_SECRET: 'binding',
    TURNSTILE_EXPECTED_HOSTNAME: 'example.com',
    DRASIL_WEB_PUBLIC_URL: 'https://example.com',
  });
  rendererReady.mockReturnValue(false);
  expect(isBotCaptchaMethodConfigured('turnstile')).toBe(true);
});

it('native setup routes method settings through the locked write and keeps None secret-free', async () => {
  const { mockDeep } = await import('jest-mock-extended');
  const { createBotSetupRuntime } = await import('../../application/adapters/setup');
  const { ConfigService } = await import('../../config/ConfigService');
  const { InMemoryServerRepository } = await import('../fakes/inMemoryRepositories');
  const { Client } = await import('discord.js');
  delete process.env.DATABASE_URL;
  const repository = new InMemoryServerRepository();
  const config = new ConfigService(repository, mockDeep<InstanceType<typeof Client>>());
  const save = jest.spyOn(config, 'updateSetupIfUnchanged');
  const fastSave = jest.spyOn(config, 'updateServerSettings');
  const deps = mockDeep<import('../../application/adapters/setup').BotSetupDependencies>();
  const actions = createBotSetupRuntime(
    { ...deps, configService: config },
    {
      loadFresh: async (guildId, userId) => ({
        guildId,
        userId,
        present: true,
        owner: true,
        permissions: '8',
        roleIds: [],
      }),
    }
  ).actions;
  const ctx = {
    guildId: 'guild',
    requestId: 'request',
    source: 'discord',
    actor: { kind: 'user' as const, userId: 'admin' },
  };
  expect(
    (
      await actions.execute(ctx, {
        kind: 'update_settings',
        section: 'verification',
        changes: { captcha_method: 'none' },
      })
    ).kind
  ).toBe('outcome');
  process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET = Buffer.alloc(32, 7).toString('base64');
  expect(
    (
      await actions.execute(ctx, {
        kind: 'update_settings',
        section: 'verification',
        changes: { captcha_method: 'discord_image' },
      })
    ).kind
  ).toBe('outcome');
  expect(save).toHaveBeenCalledTimes(2);
  expect(fastSave).not.toHaveBeenCalled();
  expect((await config.getServerConfig('guild')).settings.captcha_method_revision).toBe(1);
  await config.updateServerSettings('guild', { captcha_method: 'none' });
  expect(save).toHaveBeenCalledTimes(3);
  expect((await config.getServerConfig('guild')).settings.captcha_method_revision).toBe(2);
});
