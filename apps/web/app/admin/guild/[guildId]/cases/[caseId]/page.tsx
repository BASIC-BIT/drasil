import { WorkspaceAccessFailure } from '@/components/workspace/WorkspaceReadFailure';
import { ModerationRecordRoute } from '@/components/workspace/ModerationWorkspaceRoute';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { loadWorkspaceRoute, workspaceReturnHref } from '@/lib/workspaceRouteData';
import { notFound } from 'next/navigation';

export default async function RecordPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly guildId: string; readonly caseId: string }>;
  readonly searchParams: Promise<{ readonly returnTo?: string | string[] }>;
}) {
  const { guildId, caseId } = await params;
  const access = await loadWorkspaceRoute(guildId, `/admin/guild/${guildId}/cases/${caseId}`);
  if (access.kind !== 'ready') return <WorkspaceAccessFailure code={access.kind} />;
  const { guild, session, adapter } = access;
  const detail = await adapter.getInboxItemDetail({ guildId, itemId: `case:${caseId}` });
  if (!detail) notFound();
  return (
    <WorkspaceShell
      guildId={guildId}
      guildName={guild.name}
      sessionUsername={session.username}
      currentPage="inbox"
    >
      <ModerationRecordRoute
        detail={detail}
        loadedAt={new Date().toISOString()}
        returnHref={workspaceReturnHref(guildId, (await searchParams).returnTo)}
      />
    </WorkspaceShell>
  );
}
