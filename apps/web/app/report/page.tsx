import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { fetchDiscordGuilds } from '@/lib/discordApi';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';

export default async function ReportPage() {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect('/api/auth/discord?returnTo=/report');
  }

  const guilds = await fetchDiscordGuilds(token.accessToken);
  const configuredGuildIds = await createSetupDataAdapter().listConfiguredGuildIds(
    guilds.map((guild) => guild.id)
  );
  const reportGuilds = guilds.filter((guild) => configuredGuildIds.has(guild.id));

  return (
    <main className="shell stack">
      <nav className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" />
          <span>Drasil</span>
        </Link>
        <div className="nav-cluster">
          <Link className="button secondary" href="/admin">
            Admin
          </Link>
          <ThemeToggle />
          <AccountControl username={session.username} />
        </div>
      </nav>
      <section className="panel stack">
        <div className="section-heading server-list-heading">
          <h1 className="page-title">Report a Server User</h1>
          <p className="lede">
            Choose a shared Discord server where Drasil is configured, then submit the user ID for
            moderator review.
          </p>
        </div>
        {reportGuilds.length === 0 ? (
          <div className="card">
            <h2>No report-enabled servers found</h2>
            <p className="muted">
              Sign in with the Discord account that belongs to the server where the issue happened.
            </p>
          </div>
        ) : (
          <div className="server-list">
            {reportGuilds.map((guild) => (
              <article className="server-row" key={guild.id}>
                <div className="server-row-body">
                  <h2>{guild.name}</h2>
                  <p className="muted">Submit a direct user report to this server&apos;s queue.</p>
                  <div className="actions">
                    <Link className="button" href={`/report/guild/${guild.id}`}>
                      Report User
                    </Link>
                  </div>
                </div>
                <span className="status ok server-row-status">Configured</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
