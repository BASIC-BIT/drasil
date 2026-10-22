import type { FullConfig } from '@playwright/test';

/** Compile fixture routes before timing user interactions on a cold Next dev server. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.DRASIL_MCP_E2E === 'true') return;
  const baseURL = config.projects[0].use.baseURL;
  if (!baseURL) throw new Error('Playwright requires a base URL.');
  for (const path of [
    '/admin',
    '/admin/guild/guild-1/cases',
    '/admin/guild/guild-1/cases/case-active',
    '/admin/guild/guild-1/members/user-100',
    '/admin/guild/guild-1/history',
    '/admin/guild/guild-1/setup',
    '/admin/guild/guild-1/reports',
    '/admin/guild/guild-1/reports/report-1',
    '/admin/guild/guild-1/operations',
    '/admin/guild/guild-1/inbox',
    '/admin/guild/guild-1/onboarding',
    '/report',
    '/report/guild/guild-1',
  ]) {
    const response = await fetch(new URL(path, baseURL), { signal: AbortSignal.timeout(90_000) });
    await response.arrayBuffer();
    if (response.status >= 500)
      throw new Error(`Fixture route warmup failed: ${path} ${response.status}`);
  }
}
