import { afterEach, expect, it, vi } from 'vitest';
import { registrationIdentity } from './ingress';
afterEach(() => vi.unstubAllEnvs());
it('fails closed for unsupported topology and ambiguous caller chains', () => {
  vi.stubEnv('DRASIL_MCP_INGRESS', 'vercel-direct');
  vi.stubEnv('VERCEL', '0');
  expect(
    registrationIdentity(
      new Request('https://example', { headers: { 'x-forwarded-for': '1.2.3.4' } }),
      'x'.repeat(40)
    )
  ).toBeNull();
  vi.stubEnv('VERCEL', '1');
  for (const value of ['', '1.2.3.4,', '1.2.3.4, 5.6.7.8', 'no'])
    expect(
      registrationIdentity(
        new Request('https://example', { headers: { 'x-forwarded-for': value } }),
        'x'.repeat(40)
      )
    ).toBeNull();
});
it('keys normalized mapped IPv4 and IPv6 subnet identities', () => {
  vi.stubEnv('DRASIL_MCP_INGRESS', 'vercel-direct');
  vi.stubEnv('VERCEL', '1');
  const identity = (ip: string) =>
    registrationIdentity(
      new Request('https://example', { headers: { 'x-forwarded-for': ip } }),
      'x'.repeat(40)
    );
  expect(identity('1.2.3.4')?.hash).toBe(identity('::ffff:1.2.3.4')?.hash);
  expect(identity('2001:db8::1')?.hash).toBe(identity('2001:0db8:0000:0000::abcd')?.hash);
  expect(identity('1.2.3.4')?.hash).toMatch(/^[a-f0-9]{64}$/);
});
