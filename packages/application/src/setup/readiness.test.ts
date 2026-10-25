import { setupCaptchaMethodIssues, guildSetupUpdateSchema } from './settings';
import { captchaImageSecretConfigured } from './captchaReadiness';
const readiness = {
  siteKeyConfigured: false,
  secretKeyConfigured: false,
  bindingSecretConfigured: false,
  expectedHostname: undefined,
  publicUrl: undefined,
  imageReady: true,
};
test('image and None do not depend on Turnstile configuration', () => {
  expect(setupCaptchaMethodIssues('none', { ...readiness, imageReady: false })).toEqual([]);
  expect(setupCaptchaMethodIssues('discord_image', readiness)).toEqual([]);
  expect(
    setupCaptchaMethodIssues('discord_image', { ...readiness, imageReady: false })
  ).toHaveLength(1);
});
test('Turnstile requires four variables and a valid public origin', () => {
  expect(setupCaptchaMethodIssues('turnstile', readiness)).toHaveLength(5);
  expect(
    setupCaptchaMethodIssues('turnstile', {
      ...readiness,
      siteKeyConfigured: true,
      secretKeyConfigured: true,
      bindingSecretConfigured: true,
      expectedHostname: 'example.com',
      publicUrl: 'https://example.com',
    })
  ).toEqual([]);
});
test('image readiness requires a valid base64 secret with at least 32 decoded bytes', () => {
  for (const secret of [
    undefined,
    '',
    'plain-secret',
    '!!!!',
    Buffer.alloc(31).toString('base64'),
  ]) {
    expect(captchaImageSecretConfigured(secret)).toBe(false);
  }
  expect(captchaImageSecretConfigured(Buffer.alloc(32, 7).toString('base64'))).toBe(true);
});

test('editable setup input rejects private revision metadata in either naming convention', () => {
  for (const key of ['captchaMethodRevision', 'captcha_method_revision']) {
    expect(guildSetupUpdateSchema.safeParse({ guildId: 'guild', [key]: 7 }).success).toBe(false);
  }
});
