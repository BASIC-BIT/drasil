import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { AccountControl } from '@/components/AccountControl';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { ThemeToggle } from '@/components/ThemeToggle';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { buildBotInviteUrl } from '@/lib/discordInvite';
import { createModerationActionRequestDataAdapter } from '@/lib/moderationActionRequestDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { resolveOnboardingInitialState } from '@/lib/onboardingState';
import { completeOnboarding } from './actions';

export default async function OnboardingPage({
  params,
}: {
  readonly params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/onboarding`);
  }

  const [{ dashboard, channels, roles, canApplySetup }, requests] = await Promise.all([
    createSetupDashboardService().getDashboard(guildId, token.accessToken),
    createModerationActionRequestDataAdapter().listSetupRequests(guildId, 10),
  ]);
  const setupRequests = requests;
  const latestSetupRequest = setupRequests[0] ?? null;
  const durableRequest =
    latestSetupRequest?.status === 'completed' && dashboard.readiness !== 'ready'
      ? null
      : latestSetupRequest;
  const server = dashboard.server;
  const selectableChannels = channels.filter((channel) => channel.type === 0);
  const selectableRoles = roles.filter((role) => role.id !== guildId && !role.managed);
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
        enabled={dashboard.readiness !== 'ready'}
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
