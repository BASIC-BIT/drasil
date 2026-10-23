import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseDetailView } from './CaseDetailView';
import { fixtureCaseDetails, fixtureResolvedCaseDetails } from '@/lib/caseFixtures';
import { completedInboxActionState } from '@/lib/inboxActionState';
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from '@/lib/messageCleanupFixtures';

const noopQueueCaseAction = async () => undefined;
const noopCleanupAction = async () => completedInboxActionState('Fixture cleanup queued.');

const meta = {
  title: 'Active Triage/Case Detail',
  component: CaseDetailView,
  parameters: {
    docs: {
      description: {
        component:
          'Case detail view with Discord surface links, detection history, and persisted moderation outcomes.',
      },
    },
  },
  args: {
    canQueueCaseActions: true,
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    sessionUsername: 'Fixture Admin',
    detail: fixtureCaseDetails[0],
    queueCaseAction: noopQueueCaseAction,
  },
} satisfies Meta<typeof CaseDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StaleRestrictedCase: Story = {};

export const StaleCaseWithMessageCleanup: Story = {
  args: {
    messageCleanup: {
      combinedBanAction: noopCleanupAction,
      combinedJob: fixtureMessageCleanupJobDetails[1],
      deleteOnlyJob: fixtureMessageCleanupJobDetails[0],
      executeAction: noopCleanupAction,
      previewAction: noopCleanupAction,
      workspace: fixtureMessageCleanupCaseWorkspaces[0],
    },
  },
};

export const LeftUserCase: Story = {
  args: {
    detail: fixtureCaseDetails[1],
  },
};

export const BannedUserCase: Story = {
  args: {
    detail: fixtureCaseDetails[2],
  },
};

export const ResolvedReopenCase: Story = {
  args: {
    detail: fixtureResolvedCaseDetails[1],
  },
};

export const ImageCheckWithHistory: Story = {
  args: {
    detail: {
      ...fixtureCaseDetails[0],
      captchaChallenge: {
        id: '11111111-1111-4111-8111-111111111111',
        method: 'discord_image',
        methodRevision: 1,
        status: 'pending',
        requestSource: 'moderator',
        passEffect: 'evidence_only',
        generation: 2,
        submissionCount: 0,
        expiresAt: '2026-06-04T00:00:00.000Z',
        requestedAt: '2026-06-03T00:00:00.000Z',
        deliveredAt: null,
        deliveryErrorCode: null,
        passedAt: null,
        bypassedAt: null,
        bypassedBy: null,
        bypassReason: null,
        history: [
          {
            method: 'turnstile',
            methodRevision: 0,
            generation: 1,
            requestSource: 'moderator',
            passEffect: 'evidence_only',
            caseRevisionAtIssue: 0,
            requestedBy: 'moderator-1',
            requestedAt: '2026-06-02T00:00:00.000Z',
            presentedAt: null,
            outcome: 'cancelled',
            outcomeAt: '2026-06-03T00:00:00.000Z',
            deliveryErrorCode: null,
            bypassedBy: null,
            bypassedAt: null,
            bypassReason: null,
          },
        ],
      },
    },
  },
};
