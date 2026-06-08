import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function HomePage() {
  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span>Drasil</span>
        </div>
        <div className="nav-cluster">
          <ThemeToggle />
          <Link className="button secondary" href="/api/auth/discord?returnTo=/admin">
            Admin sign in
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Discord anti-spam operations</span>
          <h1>Review scams.</h1>
          <p className="lede">
            Drasil turns reports, restrictions, verification, and AI triage into Discord-linked
            cases without replacing moderator judgment.
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
            <h2>Ready before the first alert.</h2>
            <p className="muted">
              Sign in with Discord, choose a guild, and compare live server state with Drasil&apos;s
              saved configuration.
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
