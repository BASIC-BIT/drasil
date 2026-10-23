import type { Meta, StoryObj } from '@storybook/react-vite';
import { TurnstileChallengeForm } from './TurnstileChallengeForm';

const meta = {
  title: 'Security Checks/Turnstile',
  component: TurnstileChallengeForm,
  args: {
    token: 'fixture-token',
    siteKey: 'fixture-site-key',
    cdata: 'fixture-binding',
    attemptId: '11111111-1111-4111-8111-111111111111',
  },
  decorators: [
    (Story) => (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>Discord security check</h1>
          <Story />
        </section>
      </main>
    ),
  ],
} satisfies Meta<typeof TurnstileChallengeForm>;
export default meta;
export const ScriptFailure: StoryObj<typeof meta> = {};
