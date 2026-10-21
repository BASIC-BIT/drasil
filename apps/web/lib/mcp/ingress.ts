import { createHmac } from 'node:crypto';
import { isValidIP, normalizeIP } from '@drasil/mcp-runtime/auth-ip';
/** Trust is the documented direct Vercel overwrite, not a caller header or marker alone.
 * Operators must verify the deployed topology before opting in. No self-host fallback. */
export function registrationIdentity(
  request: Request,
  secret: string | undefined
): { ip: string; hash: string } | null {
  if (
    process.env.DRASIL_MCP_INGRESS !== 'vercel-direct' ||
    process.env.VERCEL !== '1' ||
    !secret ||
    secret.length < 32
  )
    return null;
  const raw = request.headers.get('x-forwarded-for')?.trim();
  if (!raw || raw.includes(',') || !isValidIP(raw)) return null;
  const ip = normalizeIP(raw, { ipv6Subnet: 64 });
  return {
    ip,
    hash: createHmac('sha256', secret)
      .update('drasil.mcp.registration-ip.v1\0')
      .update(ip)
      .digest('hex'),
  };
}
