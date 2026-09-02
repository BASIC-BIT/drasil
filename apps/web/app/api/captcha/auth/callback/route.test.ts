import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getCaptchaOAuthStateCookieName } from '@/lib/captchaSession';
import { GET } from './route';

describe('CAPTCHA Discord OAuth callback', () => {
  it('returns a safe response when the bound state cookie is missing', async () => {
    const request = new NextRequest(
      'https://drasil.example/api/captcha/auth/callback?code=code-1&state=state-1'
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toContain(
      `${getCaptchaOAuthStateCookieName('state-1')}=`
    );
    await expect(response.text()).resolves.toContain('Return to the security check link');
  });
});
