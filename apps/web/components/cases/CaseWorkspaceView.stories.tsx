import type { ReactNode } from 'react';
import type { CaseAction } from '@drasil/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import {
  fixtureCaseDetails,
  fixtureParkedCaseDetails,
  fixtureResolvedCaseDetails,
} from '@/lib/caseFixtures';
import { fixtureReportDetails } from '@/lib/reportFixtures';
import {
  fixtureMessageCleanupJobDetails,
  fixtureMessageCleanupCaseWorkspaces,
} from '@/lib/messageCleanupFixtures';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { ActionButton } from '@/components/workspace/Foundation';
import { Timestamp } from '@/components/workspace/Timestamp';
import { CaseWorkspaceView } from './CaseWorkspaceView';
import styles from './CaseWorkspaceView.stories.module.css';

const onIntent = fn();
const loadedAt = '2026-10-23T15:16:00.000Z';
const data: CaseWorkspaceData = {
  actorUserId: null,
  detail: fixtureCaseDetails[0],
  report: null,
  membership: null,
  requests: [],
  cleanup: null,
  policy: {
    allowedActions: ['verify_user', 'close_no_action', 'kick_user', 'ban_user'],
    canQueueCaseActions: true,
    canOpenReportCases: true,
    canManageCleanup: true,
    kickReasonRequired: true,
    banReasonRequired: true,
  },
  loadedAt,
};
const decisions: readonly {
  id: CaseAction;
  label: string;
  tone: 'positive' | 'neutral' | 'warning' | 'danger';
}[] = [
  { id: 'verify_user', label: 'Verify member', tone: 'positive' },
  { id: 'close_no_action', label: 'Close case', tone: 'neutral' },
  { id: 'kick_user', label: 'Kick member', tone: 'warning' },
  { id: 'ban_user', label: 'Ban member', tone: 'danger' },
];
const actions = (detail: CaseWorkspaceData['detail']) => (
  <section className={styles.actions} aria-label="Case decisions">
    {decisions
      .filter((decision) => detail.allowedActions.includes(decision.id))
      .map(({ id, label, tone }) => (
        <ActionButton
          key={id}
          tone={
            tone === 'positive'
              ? 'positive'
              : tone === 'warning'
                ? 'warning'
                : tone === 'danger'
                  ? 'danger'
                  : 'neutral'
          }
          onClick={() => onIntent({ action: id, target: detail.userId })}
        >
          {id === 'verify_user' && detail.caseKind === 'compromised_account'
            ? 'Verify and release'
            : label}
        </ActionButton>
      ))}
  </section>
);

const meta = {
  title: 'Moderation workspace/Case presentation',
  component: CaseWorkspaceView,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  decorators: [
    (Story) => (
      <WorkspaceShell
        guildId="guild-1"
        guildName="Example server"
        sessionUsername="Moderator"
        currentPage="cases"
      >
        <Story />
      </WorkspaceShell>
    ),
  ],
  render: (args) => (
    <CaseWorkspaceView {...args} actionArea={args.actionArea ?? actions(args.data.detail)} />
  ),
  args: {
    data,
    actionArea: null,
    tools: null,
    conversation: null,
    returnHref: '/admin/guild/guild-1/inbox',
    onOpenConversation: fn(),
  },
} satisfies Meta<typeof CaseWorkspaceView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SourceDesk: Story = {};
export const SubmittedSources: Story = {
  args: {
    data: {
      ...data,
      detail: {
        ...data.detail,
        id: fixtureReportDetails[0].latestCaseId ?? 'case-report',
        userId: fixtureReportDetails[0].targetUserId ?? 'unknown',
        userIdentity: {
          ...data.detail.userIdentity,
          id: fixtureReportDetails[0].targetUserId ?? 'unknown',
          displayLabel: fixtureReportDetails[0].targetDisplayName ?? 'Unknown member',
        },
        evidenceItems: [],
        messageContext: [],
        detectionHistory: [],
        moderationOutcomes: [],
      },
      report: fixtureReportDetails[0],
    },
  },
};
export const UnknownDates: Story = {
  args: {
    data: {
      ...data,
      detail: {
        ...data.detail,
        evidenceItems: data.detail.evidenceItems.map((record) => ({ ...record, createdAt: null })),
        detectionHistory: data.detail.detectionHistory.map((record) => ({
          ...record,
          detectedAt: null,
        })),
        moderationOutcomes: data.detail.moderationOutcomes.map((record) => ({
          ...record,
          occurredAt: null,
        })),
      },
    },
  },
};

// These nodes are injected presentation inputs. The production view owns no tool,
// mutation or conversation controller; later tasks replace these nodes with real ones.
function ToolRegion({
  title,
  status,
  children,
}: {
  readonly title: string;
  readonly status: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.tool}>
      <header>
        <h2>{title}</h2>
        <span>{status}</span>
      </header>
      {children}
    </div>
  );
}
const recoveryData: CaseWorkspaceData = {
  ...data,
  detail: { ...fixtureParkedCaseDetails[0], evidenceItems: [], messageContext: [] },
};
const quarantinePreview = (
  <ToolRegion title="Account quarantine" status="Preview ready">
    <p>
      Previewed <Timestamp value={loadedAt} />
    </p>
    <dl>
      <dt>Roles planned for removal</dt>
      <dd>Community member · role-member</dd>
      <dt>Case role</dt>
      <dd>Restricted · role-case</dd>
      <dt>Recovery thread</dt>
      <dd>Thread ID recovery-thread-1</dd>
    </dl>
    <p>Review the current role and permission preview before containment.</p>
    <ActionButton tone="warning" onClick={() => onIntent('confirm_quarantine')}>
      Review containment
    </ActionButton>
  </ToolRegion>
);
export const QuarantinePreview: Story = {
  args: {
    data: {
      ...recoveryData,
      detail: {
        ...recoveryData.detail,
        containmentStatus: 'not_applicable',
        attentionState: 'review_required',
        parkedAt: null,
        parkedBy: null,
        quarantineEffects: null,
      },
    },
    tools: quarantinePreview,
  },
};
export const IncompleteContainment: Story = {
  args: {
    data: {
      ...recoveryData,
      detail: {
        ...recoveryData.detail,
        containmentStatus: 'incomplete',
        attentionState: 'review_required',
        quarantineEffects: {
          removedRoleCount: 2,
          retainedRoleCount: 1,
          failedRoleCount: 1,
          memberBypassCount: 0,
        },
      },
    },
    tools: (
      <ToolRegion title="Account quarantine" status="Containment incomplete">
        <p>2 roles removed · 1 retained · 1 removal failed</p>
        <p>Review the failed role operation before treating this account as contained.</p>
        <ActionButton onClick={() => onIntent('refresh_preview')}>Refresh preview</ActionButton>
      </ToolRegion>
    ),
  },
};
export const AccountRecovery: Story = {
  args: {
    data: recoveryData,
    tools: (
      <ToolRegion title="Account recovery" status="Contained · Parked for recovery">
        <p>{recoveryData.detail.notes}</p>
        <p>Removed roles: {recoveryData.detail.quarantineEffects?.removedRoleCount}</p>
        <p>
          Parked <Timestamp value={recoveryData.detail.parkedAt ?? null} />
        </p>
        <a
          href={
            recoveryData.detail.surfaces.find((surface) => surface.kind === 'verification_thread')
              ?.url
          }
        >
          Recovery thread
        </a>
        <ActionButton onClick={() => onIntent('review_release')}>Review release</ActionButton>
      </ToolRegion>
    ),
  },
};

function security(
  state: 'pending' | 'passed' | 'expired' | 'delivery_failed' | 'bypassed',
  method: 'turnstile' | 'discord_image' = 'turnstile'
): Story {
  const challenge = {
    id: '11111111-1111-4111-8111-111111111111',
    status: state === 'delivery_failed' ? ('failed' as const) : state,
    method,
    methodRevision: 1,
    generation: 2,
    submissionCount: 0,
    requestSource: 'moderator' as const,
    passEffect: 'evidence_only' as const,
    expiresAt: '2026-10-23T15:30:00Z',
    requestedAt: '2026-10-23T15:10:00Z',
    deliveredAt: state === 'delivery_failed' ? null : '2026-10-23T15:11:00Z',
    deliveryErrorCode: state === 'delivery_failed' ? 'dm_unavailable' : null,
    passedAt: state === 'passed' ? '2026-10-23T15:14:00Z' : null,
    bypassedAt: state === 'bypassed' ? '2026-10-23T15:14:00Z' : null,
    bypassedBy: state === 'bypassed' ? 'moderator-1' : null,
    bypassReason: state === 'bypassed' ? 'Identity checked in the case thread.' : null,
  };
  return {
    args: {
      data: { ...data, detail: { ...data.detail, captchaChallenge: challenge } },
      tools: (
        <ToolRegion
          title={method === 'turnstile' ? 'Browser security check' : 'Discord image check'}
          status={state.replace(/_/g, ' ')}
        >
          <p>
            Generation {challenge.generation} ·{' '}
            {method === 'turnstile'
              ? 'Check link · direct message delivery'
              : 'Image check · direct message delivery'}
          </p>
          <p>
            Requested <Timestamp value={challenge.requestedAt} />
          </p>
          {state === 'pending' ? (
            <p>
              Expires <Timestamp value={challenge.expiresAt} />
            </p>
          ) : null}
          {state === 'passed' ? (
            <>
              <p>
                Passed <Timestamp value={challenge.passedAt} />
              </p>
              <p>The case remains open for moderator review.</p>
            </>
          ) : null}
          {state === 'delivery_failed' ? (
            <p>The check could not be delivered by direct message.</p>
          ) : null}
          {state === 'bypassed' ? (
            <p>
              {challenge.bypassedBy}: {challenge.bypassReason}
            </p>
          ) : null}
          {state === 'expired' || state === 'delivery_failed' ? (
            <ActionButton onClick={() => onIntent('review_retry_check')}>
              Review new check
            </ActionButton>
          ) : null}
        </ToolRegion>
      ),
    },
  };
}
export const SecurityCheckPending: Story = security('pending');
export const SecurityCheckPassed: Story = security('passed');
export const SecurityCheckExpired: Story = security('expired');
export const SecurityCheckDeliveryFailed: Story = security('delivery_failed');
export const SecurityCheckBypassed: Story = security('bypassed');
export const DiscordImageCheck: Story = security('pending', 'discord_image');

function cleanup(state: 'scope' | 'preview' | 'blocked' | 'results' | 'finalization'): Story {
  const job =
    fixtureMessageCleanupJobDetails[state === 'results' || state === 'finalization' ? 1 : 0];
  const workspace = fixtureMessageCleanupCaseWorkspaces[0];
  return {
    args: {
      data: {
        ...data,
        detail:
          state === 'blocked'
            ? { ...data.detail, status: 'banned', allowedActions: [] }
            : data.detail,
        cleanup: {
          workspace:
            state === 'blocked'
              ? {
                  ...workspace,
                  caseStatus: 'banned',
                  canPreview: false,
                  blockedReason: 'case_not_pending',
                }
              : workspace,
          jobs: [job],
        },
      },
      tools: (
        <ToolRegion
          title="Message cleanup"
          status={
            state === 'scope'
              ? 'Choose scope'
              : state === 'preview'
                ? 'Frozen preview'
                : state === 'blocked'
                  ? 'Blocked'
                  : state === 'finalization'
                    ? 'Case updates failed'
                    : 'Recorded results'
          }
        >
          {state === 'scope' ? (
            <>
              <label>
                Scope
                <select defaultValue="source_message">
                  <option value="source_message">Source message</option>
                  <option value="last_day">Last 24 hours</option>
                </select>
              </label>
              <label>
                Reason
                <textarea minLength={1} maxLength={1000} required defaultValue={job.reason} />
              </label>
              <p>Preview up to 500 candidates. Execute up to 100 messages.</p>
              <ActionButton onClick={() => onIntent('preview_cleanup')}>
                Preview messages
              </ActionButton>
            </>
          ) : state === 'blocked' ? (
            <p>The case is no longer pending. Refresh the case before requesting a new preview.</p>
          ) : (
            <>
              <p>
                Previewed <Timestamp value={job.previewedAt} />
              </p>
              <p>
                {job.outcomes.candidateCount} candidates · {job.outcomes.deletedCount} deleted ·{' '}
                {job.outcomes.permissionDeniedCount} permission denied
              </p>
              {job.items.map((item) => (
                <article key={item.id}>
                  <h3>
                    Channel ID {item.channelId} · {item.status.replace(/_/g, ' ')}
                  </h3>
                  <blockquote>{item.contentPreview}</blockquote>
                  <a href={item.sourceMessageUrl ?? undefined}>Source message</a>
                  {item.failureReason ? <p>{item.failureReason}</p> : null}
                </article>
              ))}
              {state === 'preview' ? (
                <ActionButton onClick={() => onIntent('confirm_cleanup')}>
                  Review deletion
                </ActionButton>
              ) : null}
              {state === 'finalization' ? (
                <>
                  <p>{job.lastError}</p>
                  <p>Retry updates without repeating the ban.</p>
                  <ActionButton onClick={() => onIntent('confirm_finalization')}>
                    Review case updates
                  </ActionButton>
                </>
              ) : null}
            </>
          )}
        </ToolRegion>
      ),
    },
  };
}
export const MessageCleanup: Story = cleanup('scope');
export const FrozenCleanupPreview: Story = cleanup('preview');
export const CleanupBlocked: Story = cleanup('blocked');
export const CleanupResults: Story = cleanup('results');
export const RetryCaseUpdates: Story = cleanup('finalization');

function conversation(unavailable: boolean): Story {
  return {
    args: {
      conversation: (
        <ToolRegion
          title="Conversation"
          status={unavailable ? 'Unavailable' : 'Fetched channel messages'}
        >
          {unavailable ? (
            <p>Channel message history is unavailable.</p>
          ) : (
            <>
              <p>
                Fetched <Timestamp value={loadedAt} />
              </p>
              <p>Channel ID source-channel-1</p>
              <ActionButton onClick={() => onIntent('load_older')}>
                Load earlier messages
              </ActionButton>
              {[
                {
                  id: 'one',
                  author: 'Member one',
                  content: 'Is there an announcement for this event?',
                },
                {
                  id: 'source-message-1',
                  author: data.detail.userIdentity.displayLabel,
                  content:
                    data.detail.messageContext.find((message) => message.isSource)
                      ?.contentPreview ?? '',
                },
                {
                  id: 'three',
                  author: 'Member two',
                  content: 'Please wait for the moderators to check it.',
                },
              ].map((message) => (
                <article
                  key={message.id}
                  data-source={message.id === 'source-message-1' || undefined}
                >
                  <h3>{message.author}</h3>
                  <Timestamp value={loadedAt} />
                  <blockquote>{message.content}</blockquote>
                </article>
              ))}
              <ActionButton onClick={() => onIntent('load_newer')}>
                Load newer messages
              </ActionButton>
            </>
          )}
          <a
            href={data.detail.surfaces.find((surface) => surface.kind === 'source_message')?.url}
            target="_blank"
            rel="noreferrer"
          >
            Open in Discord
          </a>
        </ToolRegion>
      ),
    },
  };
}
export const ChannelConversation: Story = conversation(false);
export const ConversationUnavailable: Story = conversation(true);

function receipt(
  state: 'queued' | 'processing' | 'failed' | 'updates' | 'unknown' | 'resolved'
): Story {
  const summary: ModerationActionRequestSummary = {
    id: 'request-ban-1',
    actionType: 'ban_user',
    actorSurface: 'web_case',
    completedAt: null,
    detectionEventId: null,
    failedAt: state === 'failed' ? loadedAt : null,
    lastError: state === 'failed' ? 'Request failed before execution.' : null,
    messageDeletionJobId: null,
    requestedAt: loadedAt,
    reportIntakeId: null,
    requestedAction: 'ban_user',
    resultSummary: null,
    status:
      state === 'queued' || state === 'processing' || state === 'failed' ? state : 'completed',
    targetUserId: data.detail.userId,
    updatedAt: loadedAt,
    verificationEventId: data.detail.id,
    observedBanResult:
      state === 'updates'
        ? { status: 'banned_updates_pending', operationId: 'operation-1' }
        : state === 'unknown'
          ? { status: 'ban_outcome_unknown', operationId: 'operation-1' }
          : null,
  };
  const labels = {
    queued: 'Ban request queued',
    processing: 'Ban request processing',
    failed: 'Ban request failed',
    updates: 'Ban confirmed · Case updates pending',
    unknown: 'Ban outcome unknown',
    resolved: 'Resolved by another moderator',
  };
  return {
    args: {
      data: {
        ...data,
        requests: state === 'resolved' ? [] : [summary],
        detail:
          state === 'resolved'
            ? { ...fixtureResolvedCaseDetails[0], allowedActions: [] }
            : data.detail,
      },
      actionArea: (
        <section
          className={styles.receipt}
          role={state === 'failed' || state === 'unknown' ? 'alert' : 'status'}
        >
          <h2>{labels[state]}</h2>
          {state === 'resolved' ? (
            <p>Current case status: {fixtureResolvedCaseDetails[0].status}</p>
          ) : (
            <>
              <p>
                Request ID {summary.id} · <Timestamp value={summary.requestedAt} />
              </p>
              {summary.lastError ? <p>{summary.lastError}</p> : null}
            </>
          )}
          {state === 'unknown' ? (
            <p>Review the recorded request before attempting another ban.</p>
          ) : null}
          {state === 'updates' ? <p>Retry case updates without repeating the ban.</p> : null}
          <a href="/admin/guild/guild-1/inbox">Back to inbox</a>
        </section>
      ),
    },
  };
}
export const ActionQueued: Story = receipt('queued');
export const ActionProcessing: Story = receipt('processing');
export const ActionFailed: Story = receipt('failed');
export const BanUpdatesPending: Story = receipt('updates');
export const BanOutcomeUnknown: Story = receipt('unknown');
export const ResolvedByAnotherModerator: Story = receipt('resolved');
