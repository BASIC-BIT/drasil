import Link from 'next/link';
import { redirect } from 'next/navigation';
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
        <form action="/api/auth/logout" method="post">
          <button className="button secondary" type="submit">
            Sign out {session.username}
          </button>
        </form>
      </nav>
      <section className="panel stack">
        <div>
          <h1 className="page-title">Choose a server.</h1>
          <p className="lede">
            These are Discord guilds where your account is owner or has Manage Server. Drasil only
            changes a guild after you save settings for that guild.
          </p>
        </div>
        {guilds.length === 0 ? (
          <div className="card">
            <h2>No manageable guilds found</h2>
            <p className="muted">Sign in with a Discord account that can manage a server.</p>
          </div>
        ) : (
          <div className="grid">
            {guilds.map((guild) => (
              <Link className="card stack" href={`/admin/guild/${guild.id}/setup`} key={guild.id}>
                <div className={guild.configured ? 'status ok' : 'status warning'}>
                  {guild.configured ? 'Configured' : 'Needs setup'}
                </div>
                <div>
                  <h2>{guild.name}</h2>
                  <p className="muted">Review setup, diagnostics, and moderation policy.</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
