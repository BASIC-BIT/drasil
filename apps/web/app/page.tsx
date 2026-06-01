import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span>Drasil</span>
        </div>
        <Link className="button secondary" href="/api/auth/discord?returnTo=/admin">
          Admin sign in
        </Link>
      </nav>
      <section className="hero">
        <div>
          <h1>Anti-spam setup without Discord modal gymnastics.</h1>
          <p className="lede">
            Drasil helps moderators tune detection, reports, restricted roles, verification
            channels, and AI triage from a single setup surface while keeping enforcement in each
            server owner&apos;s control.
          </p>
          <div className="actions">
            <Link className="button" href="/api/auth/discord?returnTo=/admin">
              Open setup dashboard
            </Link>
            <a
              className="button secondary"
              href="https://github.com/BASIC-BIT/drasil/blob/main/docs/workflow.md"
            >
              Read workflow
            </a>
          </div>
        </div>
        <aside className="panel stack">
          <div>
            <span className="status ok">First slice</span>
            <h2>Guild setup diagnostics</h2>
            <p className="muted">
              Sign in with Discord, pick a guild you can manage, and review Drasil&apos;s live setup
              state against the persisted Supabase-backed configuration.
            </p>
          </div>
          <div className="grid">
            <div className="card">
              <h3>Local control</h3>
              <p className="muted">Reports and AI triage stay server-local by default.</p>
            </div>
            <div className="card">
              <h3>Adapter seam</h3>
              <p className="muted">
                Postgres works now; Convex can be added behind the same shape.
              </p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
