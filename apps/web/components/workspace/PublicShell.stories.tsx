import type { Meta, StoryObj } from '@storybook/react-vite';
import { TurnstileChallengeForm } from '@/components/captcha/TurnstileChallengeForm';
import { AccountControl } from '@/components/AccountControl';
import { PublicShell } from './PublicShell';
import { WorkspaceReadFailure } from './WorkspaceReadFailure';

const meta = {
  title: 'Moderation workspace/Public shell',
  component: PublicShell,
  // Playwright owns the explicit axe scan, avoiding concurrent addon scans.
  globals: { a11y: { manual: true } },
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  args: {
    children: (
      <main className="shell stack">
        <h1>Choose a Server</h1>
        <p className="lede">Select a server to review moderation, history and settings.</p>
      </main>
    ),
  },
} satisfies Meta<typeof PublicShell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ServerPicker: Story = { args: { actions: <AccountControl username="Moderator" /> } };
export const PublicReport: Story = {
  args: {
    actions: <a href="/report">Report Servers</a>,
    children: (
      <main className="shell stack">
        <h1>Report a Server User</h1>
        <form className="panel stack">
          <label htmlFor="report-user">Discord user ID</label>
          <input id="report-user" name="userId" />
          <label htmlFor="report-reason">Reason</label>
          <textarea id="report-reason" name="reason" />
          <button className="button">Submit Report</button>
        </form>
      </main>
    ),
  },
};
export const CaptchaUnavailable: Story = {
  args: {
    children: (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>CAPTCHA unavailable</h1>
          <p>This link is invalid or no longer active. Ask a moderator for a new CAPTCHA.</p>
        </section>
      </main>
    ),
  },
};
export const ReadFailure: Story = {
  args: {
    children: (
      <main className="shell">
        <WorkspaceReadFailure
          code="internal_error"
          headingLevel={1}
          returnTo="/admin"
          onRetry={() => {}}
        />
      </main>
    ),
  },
};

export const CaptchaPending: Story = {
  args: {
    children: (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>CAPTCHA</h1>
          <p>Complete the CAPTCHA below.</p>
          <TurnstileChallengeForm
            token="fixture-token"
            siteKey="fixture-site-key"
            cdata="fixture-binding"
            attemptId="11111111-1111-4111-8111-111111111111"
          />
        </section>
      </main>
    ),
  },
};
