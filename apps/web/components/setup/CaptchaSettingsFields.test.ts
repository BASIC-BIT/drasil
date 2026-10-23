import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getEffectiveCaptchaMethod } from '@drasil/contracts';
import { CaptchaSettingsFields } from './CaptchaSettingsFields';

const preferences = {
  mode: 'suspicious_join' as const,
  passAction: 'evidence_only' as const,
  lifetimeHours: 24,
  maxSubmissions: 5,
  readinessIssues: { none: [], turnstile: [], discord_image: [] },
};

describe('administrator CAPTCHA settings', () => {
  it('displays legacy active servers as Turnstile without changing issuance preferences', () => {
    const method = getEffectiveCaptchaMethod({ captcha_mode: 'suspicious_join' });
    const markup = renderToStaticMarkup(
      createElement(CaptchaSettingsFields, { ...preferences, method })
    );
    expect(markup).toContain('<option value="turnstile" selected="">Cloudflare Turnstile</option>');
    expect(markup).toContain('<option value="suspicious_join" selected="">');
    expect(markup).not.toContain('all_cases');
    expect(markup).not.toContain('name="captchaMethodRevision"');
  });

  it('omits issuance fields for None so a save preserves stored preferences', () => {
    const markup = renderToStaticMarkup(
      createElement(CaptchaSettingsFields, { ...preferences, method: 'none' })
    );
    expect(markup).toContain('<option value="none" selected="">None</option>');
    for (const name of [
      'captchaMode',
      'captchaPassAction',
      'captchaChallengeLifetimeHours',
      'captchaMaxSubmissions',
    ]) {
      expect(markup).not.toContain(`name="${name}"`);
    }
    expect(markup).toContain('Saved issuance and pass preferences are retained.');
  });
});

it('active methods use manual or suspicious join issuance and keep Off only for already paused settings', () => {
  const active = renderToStaticMarkup(
    createElement(CaptchaSettingsFields, {
      ...preferences,
      method: 'discord_image',
      mode: 'manual',
    })
  );
  expect(active).not.toContain('<option value="off"');
  const paused = renderToStaticMarkup(
    createElement(CaptchaSettingsFields, { ...preferences, method: 'turnstile', mode: 'off' })
  );
  expect(paused).toContain('<option value="off" selected="">Off</option>');
});
