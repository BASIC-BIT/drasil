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
          <span className="eyebrow">Discord anti-spam operations</span>
          <h1>Catch scam accounts before moderation turns into archaeology.</h1>
          <p className="lede">
            Drasil gives server teams one place to wire reports, verification, restricted roles,
            active cases, and AI triage while keeping final enforcement in Discord where moderator
            history already lives.
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
            <span className="status info">Setup dashboard</span>
            <h2>Know what is ready before the first alert.</h2>
            <p className="muted">
              Sign in with Discord, choose a guild you manage, and compare live Discord state with
              Drasil&apos;s saved configuration before moderators depend on it.
            </p>
          </div>
          <div className="grid">
            <div className="card">
              <h3>Evidence stays visible</h3>
              <p className="muted">Case links point back to Discord threads and messages.</p>
            </div>
            <div className="card">
              <h3>Policy stays explicit</h3>
              <p className="muted">
                Tune detection response modes without changing bot code or losing provenance.
              </p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
