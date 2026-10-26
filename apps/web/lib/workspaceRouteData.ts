import { redirect } from 'next/navigation';
import { loadWorkspaceAccess } from './workspaceAccess';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from './session';
import { resolveWorkspaceReturnTo } from './workspaceConfirmation';

export async function loadWorkspaceRoute(guildId: string, path: string) {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  const access = await loadWorkspaceAccess(guildId, session, token);
  if (access.kind === 'authentication_required' || !session)
    redirect(`/api/auth/discord?${new URLSearchParams({ returnTo: path })}`);
  if (access.kind !== 'ready') return access;
  return {
    kind: 'ready' as const,
    guild: access.guild,
    session,
    adapter: createModerationWorkspaceDataAdapter(access.actor),
  };
}

export function workspaceReturnHref(guildId: string, value: string | string[] | undefined): string {
  const form = new FormData();
  if (typeof value === 'string') form.set('returnTo', value);
  return resolveWorkspaceReturnTo(
    form,
    guildId,
    `/admin/guild/${encodeURIComponent(guildId)}/inbox`
  );
}

/** Early reporter replies retain their report URL before a target is confirmed. */
export async function loadReportWorkspace(
  guildId: string,
  reportId: string,
  adapter: ReturnType<typeof createModerationWorkspaceDataAdapter>
) {
  return adapter.getInboxItemDetail({ guildId, itemId: `report:${reportId}` });
}
