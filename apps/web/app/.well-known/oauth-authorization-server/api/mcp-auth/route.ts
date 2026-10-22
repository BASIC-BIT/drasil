import { getMcpConfig } from '@/lib/mcp/config';
export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
  if (!getMcpConfig()) return new Response(null, { status: 404 });
  const { getMcpIssuer } = await import('@/lib/mcp/auth/issuer');
  return getMcpIssuer()!.discovery(request);
}
