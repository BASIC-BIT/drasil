import { notFound, redirect } from 'next/navigation';
import { createWebAuthority } from './application/adapters/authority';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from './session';
import { createSetupDashboardService } from './setupDashboardService';
import { resolveWorkspaceReturnTo } from './workspaceConfirmation';

export async function loadWorkspaceRoute(guildId: string, path: string) {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) redirect(`/api/auth/discord?${new URLSearchParams({ returnTo: path })}`);
  const guild = await createSetupDashboardService().assertCanManageGuild(
    guildId,
    token.accessToken
  );
  const actor = await createWebAuthority().loadFresh(guildId, session.userId);
  if (!actor || !actor.present || actor.guildId !== guildId) notFound();
  return { guild, session, adapter: createModerationWorkspaceDataAdapter(actor) };
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
