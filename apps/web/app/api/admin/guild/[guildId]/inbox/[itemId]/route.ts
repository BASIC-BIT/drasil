import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { loadWorkspaceAccess } from '@/lib/workspaceAccess';
import { classifyReadFailure, recordReadDependency } from '@/lib/readDiagnostics';
import { withReadRequestContext } from '@/lib/readRequestContext';
import { createModerationWorkspaceDataAdapter } from '@/lib/moderationWorkspaceDataAdapter';
import { workspaceItemDetailSchema } from '@/lib/moderationWorkspaceTypes';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ guildId: string; itemId: string }> }
): Promise<NextResponse> {
  return withReadRequestContext({ operation: 'selected_workspace_read' }, async () => {
    try {
      const [session, token] = await Promise.all([
        getCurrentAdminSession(),
        getCurrentDiscordToken(),
      ]);
      const { guildId, itemId } = await context.params;
      const access = await loadWorkspaceAccess(guildId, session, token);
      if (access.kind !== 'ready') {
        const status =
          access.kind === 'authentication_required'
            ? 401
            : access.kind === 'access_denied'
              ? 403
              : 503;
        const responseHeaders = new Headers(headers);
        if (access.kind === 'unavailable' && access.retryAfterSeconds)
          responseHeaders.set('Retry-After', String(access.retryAfterSeconds));
        return NextResponse.json({ code: access.kind }, { status, headers: responseHeaders });
      }
      const detail = await createModerationWorkspaceDataAdapter(access.actor).getInboxItemDetail({
        guildId,
        itemId,
      });
      if (!detail) return NextResponse.json({ code: 'not_found' }, { status: 404, headers });
      return NextResponse.json(workspaceItemDetailSchema.parse(detail), { headers });
    } catch (error) {
      recordReadDependency({
        ...classifyReadFailure(error),
        boundary: 'query',
        latencyMs: null,
        attempt: 1,
      });
      return NextResponse.json({ code: 'internal_error' }, { status: 500, headers });
    }
  });
}
