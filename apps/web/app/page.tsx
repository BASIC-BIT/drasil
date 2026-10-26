import Link from 'next/link';
import { PublicShell } from '@/components/workspace/PublicShell';
import styles from './page.module.css';

export default function HomePage() {
  return (
    <PublicShell actions={<Link href="/api/auth/discord?returnTo=/admin">Admin sign in</Link>}>
      <main className={`shell ${styles.home}`}>
        <section className={styles.introduction}>
          <p className="muted">Discord moderation</p>
          <h1>Shared protection.</h1>
          <p className="lede">
            Bring reports, cases and verification into one moderation workspace. Review evidence,
            follow up in Discord and choose how Drasil responds in your server.
          </p>
          <div className="actions">
            <Link className="button" href="/api/auth/discord?returnTo=/admin">
              Open moderation workspace
            </Link>
            <Link className="button secondary" href="/api/auth/discord?returnTo=/report">
              Report a user
            </Link>
          </div>
        </section>
        <section className={styles.links} aria-label="Drasil resources">
          <div>
            <h2>Moderation with context</h2>
            <p className="muted">Review reports and case history with links to Discord evidence.</p>
            <a href="https://github.com/BASIC-BIT/drasil/blob/main/docs/workflow.md">
              Read workflow
            </a>
          </div>
          <div>
            <h2>Your server settings</h2>
            <p className="muted">Configure detection responses and reporting for your community.</p>
            <Link href="/api/auth/discord?returnTo=/admin">Open server settings</Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
