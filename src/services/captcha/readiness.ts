import {
  setupCaptchaMethodIssues,
  captchaImageSecretConfigured,
  type CaptchaMethod,
} from '@drasil/application';
import { isCaptchaImageRendererReady } from './imageRenderer';

export function isBotCaptchaMethodConfigured(method: Exclude<CaptchaMethod, 'none'>): boolean {
  return (
    setupCaptchaMethodIssues(method, {
      imageReady:
        method === 'discord_image' &&
        captchaImageSecretConfigured(process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET) &&
        isCaptchaImageRendererReady(),
      siteKeyConfigured: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
      secretKeyConfigured: Boolean(process.env.TURNSTILE_SECRET_KEY?.trim()),
      bindingSecretConfigured: Boolean(process.env.DRASIL_CAPTCHA_BINDING_SECRET?.trim()),
      expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim(),
      publicUrl:
        process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.DRASIL_WEB_PUBLIC_URL?.trim(),
    }).length === 0
  );
}

export function botCaptchaReadiness(): { turnstile: boolean; discord_image: boolean } {
  return {
    turnstile: isBotCaptchaMethodConfigured('turnstile'),
    discord_image: isBotCaptchaMethodConfigured('discord_image'),
  };
}
