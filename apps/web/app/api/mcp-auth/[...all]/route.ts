import { getMcpConfig } from '@/lib/mcp/config';
export const runtime = 'nodejs';
async function handle(request: Request): Promise<Response> {
  if (!getMcpConfig()) return new Response(null, { status: 404 });
  const { getMcpIssuer } = await import('@/lib/mcp/auth/issuer');
  return getMcpIssuer()!.handler(request);
}
export const GET = handle;
export const POST = handle;
