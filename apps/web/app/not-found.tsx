import { PublicShell } from '@/components/workspace/PublicShell';

export default function NotFound() {
  return (
    <PublicShell>
      <main className="shell stack">
        <h1>Page not found</h1>
        <p>This page is no longer available or the address is incorrect.</p>
        <a href="/">Return home</a>
      </main>
    </PublicShell>
  );
}
