import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { AccountControl } from '@/components/AccountControl';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { ThemeToggle } from '@/components/ThemeToggle';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { buildBotInviteUrl } from '@/lib/discordInvite';
import { hasActiveInboxActionRequests } from '@/lib/inboxActionReceipts';
import { createModerationActionRequestDataAdapter } from '@/lib/moderationActionRequestDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import {
  createSetupDashboardService,
  filterAssignableCaseRoles,
} from '@/lib/setupDashboardService';
import {
  resolveOnboardingDurableRequest,
  resolveOnboardingInitialState,
} from '@/lib/onboardingState';
import { completeOnboarding } from './actions';

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ guildId: string }>;
  readonly searchParams: Promise<{ setupRequestId?: string | string[] }>;
}) {
  const { guildId } = await params;
  const rawTrackedRequestId = (await searchParams).setupRequestId;
  const trackedRequestId =
    typeof rawTrackedRequestId === 'string' && rawTrackedRequestId.trim().length <= 100
      ? rawTrackedRequestId.trim() || null
      : null;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/onboarding`);
  }

  const requestAdapter = createModerationActionRequestDataAdapter();
  const [{ dashboard, channels, roles, botRoleIds, canApplySetup }, requests, trackedRequest] =
    await Promise.all([
      createSetupDashboardService().getDashboard(guildId, token.accessToken),
      requestAdapter.listSetupRequests(guildId, 10),
      trackedRequestId
        ? requestAdapter.getSetupRequest(guildId, trackedRequestId)
        : Promise.resolve(null),
    ]);
  const setupRequests =
    trackedRequest && !requests.some((request) => request.id === trackedRequest.id)
      ? [trackedRequest, ...requests]
      : requests;
  const latestSetupRequest = trackedRequestId ? trackedRequest : (setupRequests[0] ?? null);
  const durableRequest = resolveOnboardingDurableRequest(
    latestSetupRequest,
    dashboard.readiness,
    trackedRequestId
  );
  const server = dashboard.server;
  const selectableChannels = channels.filter((channel) => channel.type === 0);
  const selectableRoles = filterAssignableCaseRoles(roles, botRoleIds, guildId);
  const initialState = resolveOnboardingInitialState(server, durableRequest, randomUUID(), {
    channelIds: selectableChannels.map((channel) => channel.id),
    roleIds: selectableRoles.map((role) => role.id),
  });
  const action = completeOnboarding.bind(null, guildId);

  return (
    <main className="shell stack">
      <nav className="topbar">
        <Link className="brand" href="/admin">
          <span className="brand-mark" />
          <span>Drasil</span>
        </Link>
        <div className="nav-cluster">
          <Link href={`/admin/guild/${guildId}/setup`}>Full settings</Link>
          <ThemeToggle />
          <AccountControl username={session.username} />
        </div>
      </nav>
      <InboxActionRequestPollingProvider
        enabled={dashboard.readiness !== 'ready' || hasActiveInboxActionRequests(setupRequests)}
        serverRequests={setupRequests}
      >
        <OnboardingWizard
          action={action}
          canApplySetup={canApplySetup}
          channels={selectableChannels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
          }))}
          checklist={dashboard.checklist}
          durableRequest={durableRequest}
          guildId={guildId}
          guildName={dashboard.guildName}
          initialValues={initialState.values}
          initialSubmissionId={initialState.submissionId}
          inviteUrl={buildBotInviteUrl('standard', guildId)}
          readiness={dashboard.readiness}
          roles={selectableRoles.map((role) => ({ id: role.id, name: role.name }))}
        />
      </InboxActionRequestPollingProvider>
    </main>
  );
}
