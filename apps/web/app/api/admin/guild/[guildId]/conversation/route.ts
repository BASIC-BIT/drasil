import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import {
  conversationQuerySchema,
  conversationReadResultSchema,
  readConversationPage,
} from '@/lib/conversationDataAdapter';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> }
): Promise<NextResponse> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token)
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401, headers });
  const { guildId } = await context.params;
  const params = request.nextUrl.searchParams;
  const allowed = ['recordKind', 'recordId', 'sourceKey', 'page', 'cursor'];
  if (
    !/^\d{17,20}$/.test(guildId) ||
    [...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)
  )
    return NextResponse.json({ error: 'Invalid conversation query.' }, { status: 400, headers });
  const query = conversationQuerySchema.safeParse({
    recordKind: params.get('recordKind'),
    recordId: params.get('recordId'),
    sourceKey: params.get('sourceKey'),
    page: {
      kind: params.get('page'),
      ...(params.has('cursor') ? { cursor: params.get('cursor') } : {}),
    },
  });
  if (!query.success)
    return NextResponse.json({ error: 'Invalid conversation query.' }, { status: 400, headers });
  try {
    const guild = await createSetupDashboardService().assertCanManageGuild(
      guildId,
      token.accessToken
    );
    if (guild.id !== guildId) throw new Error('Guild mismatch');
  } catch {
    return NextResponse.json({ error: 'Guild access denied.' }, { status: 403, headers });
  }
  try {
    const result = await readConversationPage({
      guildId,
      actorId: session.userId,
      query: query.data,
    });
    return NextResponse.json(conversationReadResultSchema.parse(result), { headers });
  } catch {
    return NextResponse.json({ kind: 'unavailable', reason: 'upstream' }, { status: 502, headers });
  }
}
