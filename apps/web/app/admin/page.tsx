import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

export default async function AdminPage() {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect('/api/auth/discord?returnTo=/admin');
  }

  const service = createSetupDashboardService();
  const guilds = await service.listManageableGuilds(token.accessToken);

  return (
    <main className="shell stack">
      <nav className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" />
          <span>Drasil</span>
        </Link>
        <div className="nav-cluster">
          <ThemeToggle />
          <AccountControl username={session.username} />
        </div>
      </nav>
      <section className="panel stack">
        <div className="section-heading server-list-heading">
          <h1 className="page-title">Choose a Server</h1>
          <p className="lede">
            Select a server to review setup health, active cases, and moderation policy.
          </p>
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
                  <p className="muted">Open setup diagnostics or review active moderation cases.</p>
                  <div className="actions">
                    <Link className="button" href={`/admin/guild/${guild.id}/cases`}>
                      Active Cases
                    </Link>
                    <Link className="button secondary" href={`/admin/guild/${guild.id}/reports`}>
                      Reports
                    </Link>
                    <Link className="button secondary" href={`/admin/guild/${guild.id}/setup`}>
                      Setup
                    </Link>
                  </div>
                </div>
                <span
                  className={
                    guild.configured
                      ? 'status ok server-row-status'
                      : 'status warning server-row-status'
                  }
                >
                  {guild.configured ? 'Configured' : 'Needs setup'}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
