import { ModerationInboxRoute } from '@/components/workspace/ModerationWorkspaceRoute';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { parseInboxLocation } from '@/lib/inboxLocation';
import { createModerationInboxDataAdapter } from '@/lib/moderationInboxDataAdapter';
import { loadWorkspaceRoute } from '@/lib/workspaceRouteData';

export default async function ModerationInboxPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly guildId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guildId } = await params;
  const { guild, session } = await loadWorkspaceRoute(guildId, `/admin/guild/${guildId}/inbox`);
  const items = await createModerationInboxDataAdapter().listInboxItems(guildId);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (typeof value === 'string') query.set(key, value);
  return (
    <WorkspaceShell
      guildId={guildId}
      guildName={guild.name}
      sessionUsername={session.username}
      currentPage="inbox"
    >
      <ModerationInboxRoute
        guildId={guildId}
        items={items}
        initialLocation={parseInboxLocation(query)}
      />
    </WorkspaceShell>
  );
}
