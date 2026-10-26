import { AccountControl } from '@/components/AccountControl';
import { PublicShell } from '@/components/workspace/PublicShell';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import Link from 'next/link';
import { redirect } from 'next/navigation';

const READINESS_LABELS = {
  not_installed: 'Install Drasil',
  needs_setup: 'Needs setup',
  blocked: 'Setup blocked',
  ready: 'Ready',
} as const;

export default async function AdminPage() {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect('/api/auth/discord?returnTo=/admin');
  }

  const service = createSetupDashboardService();
  const guilds = await service.listManageableGuilds(token.accessToken);

  return (
    <PublicShell brandHref="/" actions={<AccountControl username={session.username} />}>
      <main className="shell stack">
        <section className="panel stack">
          <div className="section-heading server-list-heading">
            <h1 className="page-title">Choose a Server</h1>
            <p className="lede">Select a server to review moderation, history and settings.</p>
          </div>
          {guilds.length === 0 ? (
            <div className="card">
              <h2>No manageable guilds found</h2>
              <p className="muted">Sign in with a Discord account that can manage a server.</p>
            </div>
          ) : (
            <div className="server-list">
              {guilds.map((guild) => (
                <article className="server-row" key={guild.id}>
                  <div className="server-row-body">
                    <h2>{guild.name}</h2>
                    <p className="muted">
                      {guild.readiness === 'ready'
                        ? 'Review reports, cases and replies in the moderation inbox.'
                        : guild.readiness === 'not_installed'
                          ? 'Install Drasil and configure protection for this server.'
                          : 'Complete setup and review moderation, history and settings.'}
                    </p>
                    <div className="actions">
                      <Link className="button" href={`/admin/guild/${guild.id}/inbox`}>
                        Inbox
                      </Link>
                      <Link className="button secondary" href={`/admin/guild/${guild.id}/history`}>
                        History
                      </Link>
                      <Link
                        className="button secondary"
                        href={`/admin/guild/${guild.id}/operations`}
                      >
                        Operations
                      </Link>
                      <Link
                        className="button secondary"
                        href={`/admin/guild/${guild.id}/${guild.readiness === 'ready' ? 'setup' : 'onboarding'}`}
                      >
                        {guild.readiness === 'ready' ? 'Setup' : 'Finish setup'}
                      </Link>
                    </div>
                  </div>
                  <span
                    className={
                      guild.readiness === 'ready'
                        ? 'status ok server-row-status'
                        : guild.readiness === 'blocked'
                          ? 'status error server-row-status'
                          : 'status warning server-row-status'
                    }
                  >
                    {READINESS_LABELS[guild.readiness]}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </PublicShell>
  );
}
