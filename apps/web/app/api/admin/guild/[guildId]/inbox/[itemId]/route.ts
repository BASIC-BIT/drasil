import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { createModerationWorkspaceDataAdapter } from '@/lib/moderationWorkspaceDataAdapter';
import { workspaceItemDetailSchema } from '@/lib/moderationWorkspaceTypes';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ guildId: string; itemId: string }> }
): Promise<NextResponse> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token)
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
  const { guildId, itemId } = await context.params;
  let guild;
  try {
    guild = await createSetupDashboardService().assertCanManageGuild(guildId, token.accessToken);
  } catch {
    return NextResponse.json({ error: 'Guild access denied.' }, { status: 403, headers });
  }
  try {
    const detail = await createModerationWorkspaceDataAdapter({
      guildId: guild.id,
      userId: session.userId,
      present: true,
      owner: guild.owner,
      permissions: guild.permissions,
      roleIds: [],
    }).getInboxItemDetail({ guildId, itemId });
    if (!detail)
      return NextResponse.json({ error: 'Inbox item not found.' }, { status: 404, headers });
    return NextResponse.json(workspaceItemDetailSchema.parse(detail), { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load inbox item.' }, { status: 500, headers });
  }
}
