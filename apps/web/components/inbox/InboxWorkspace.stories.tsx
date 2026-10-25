import { useCallback, useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { moderationInboxItemSchema, type ModerationInboxItem } from '@drasil/contracts';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { fixtureReportDetails } from '@/lib/reportFixtures';
import { parseInboxLocation } from '@/lib/inboxLocation';
import type { WorkspaceItemDetail } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { InboxWorkspace } from './InboxWorkspace';

const fixtureItems = fixtureModerationInboxItems();
const base = fixtureItems[0];
const items: ModerationInboxItem[] = [
  ...fixtureItems.filter((item) => item.kind !== 'support_attention'),
  ...(['report_attention', 'support_attention', 'pending_screening'] as const).map((kind) =>
    moderationInboxItemSchema.parse({
      ...base,
      id: `queue:${kind}`,
      kind,
      sourceId:
        kind === 'report_attention'
          ? fixtureReportDetails[0].id
          : kind === 'support_attention'
            ? fixtureCaseDetails[0].id
            : 'screening-member',
      queueItemId: `queue-${kind}`,
      title:
        kind === 'report_attention'
          ? 'Reporter follow-up'
          : kind === 'support_attention'
            ? 'Recovery reply'
            : 'Pending screening',
      subject: {
        userId:
          kind === 'report_attention'
            ? fixtureReportDetails[0].reporterId
            : kind === 'support_attention'
              ? fixtureCaseDetails[0].userId
              : 'screening-member',
        displayLabel:
          kind === 'pending_screening'
            ? 'orbit'
            : kind === 'report_attention'
              ? 'juniper'
              : 'recovery member',
        secondaryLabel: null,
        avatarUrl: null,
      },
      createdAt: null,
      updatedAt: null,
      summary:
        kind === 'pending_screening'
          ? 'Discord membership screening pending'
          : 'Complete follow-up source text',
      allowedActions:
        kind === 'pending_screening' ? ['open_discord'] : ['acknowledge', 'open_discord'],
      detailHref: null,
      links: [
        { label: 'Open source', url: 'https://discord.com/channels/guild-1/thread-1/message-1' },
      ],
    })
  ),
];
const policy = {
  allowedActions: base.allowedActions,
  canQueueCaseActions: true,
  canOpenReportCases: true,
  canManageCleanup: true,
  kickReasonRequired: true,
  banReasonRequired: true,
};
function observedStoryItem(): ModerationInboxItem {
  const item = items.find((value) => value.kind === 'observed_alert');
  if (!item) throw new Error('Observed story input missing');
  return item;
}
const observed = observedStoryItem();
const request: ModerationActionRequestSummary = {
  id: 'inbox-request',
  actionType: 'dismiss_observed_detection',
  requestedAction: 'dismiss_no_action',
  actorSurface: 'web',
  detectionEventId: observed.sourceId,
  verificationEventId: null,
  reportIntakeId: null,
  targetUserId: observed.subject.userId,
  completedAt: null,
  failedAt: null,
  lastError: null,
  messageDeletionJobId: null,
  requestedAt: '2026-10-25T12:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
  resultSummary: null,
  status: 'completed',
};
function Runnable({
  empty = false,
  wrongIdentity = false,
  wrongPayload = false,
  responseLoss = false,
}: {
  readonly empty?: boolean;
  readonly wrongIdentity?: boolean;
  readonly wrongPayload?: boolean;
  readonly responseLoss?: boolean;
}) {
  const [summaries, setSummaries] = useState(empty ? [] : items);
  const [revision, setRevision] = useState(0);
  const disabled = useRef(false);
  const done = useRef(false);
  const caseRequest = useRef<ModerationActionRequestSummary | null>(null);
  const [submissions, setSubmissions] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  const [initialLocation] = useState(() =>
    parseInboxLocation(new URLSearchParams(window.location.search))
  );
  useEffect(() => {
    const refresh = () => {
      setSummaries((previous) => [...previous]);
      setRevision((value) => value + 1);
      setRefreshes((value) => value + 1);
    };
    window.addEventListener('storybook:router-refresh', refresh);
    return () => window.removeEventListener('storybook:router-refresh', refresh);
  }, []);
  const loadDetail = useCallback(
    async (id: string, _signal: AbortSignal): Promise<WorkspaceItemDetail> => {
      const item = items.find((value) => value.id === id);
      if (!item) throw new Error('Unavailable');
      // Deliberately ignore abort to prove the production controller rejects a late response.
      await new Promise((resolve) =>
        setTimeout(resolve, responseLoss && revision > 0 ? 700 : item.kind === 'case' ? 800 : 35)
      );
      const currentItem = wrongIdentity
        ? { ...item, guildId: 'other-guild' }
        : { ...item, allowedActions: disabled.current ? [] : item.allowedActions };
      const currentPolicy = { ...policy, allowedActions: currentItem.allowedActions };
      const requests = done.current
        ? [request]
        : new URLSearchParams(window.location.search).get('request') === request.id
          ? [request]
          : [];
      switch (currentItem.kind) {
        case 'case':
          return {
            kind: 'case',
            item: { ...currentItem, kind: 'case' },
            policy: currentPolicy,
            data: {
              detail: fixtureCaseDetails[0],
              report: null,
              membership: null,
              cleanup: null,
              requests: [
                ...(caseRequest.current ? [caseRequest.current] : []),
                ...(new URLSearchParams(window.location.search).get('request') ===
                'security-request'
                  ? [
                      {
                        ...request,
                        id: 'security-request',
                        actionType: 'request_captcha_challenge',
                        requestedAction: 'challenge_user',
                        detectionEventId: null,
                        verificationEventId: fixtureCaseDetails[0].id,
                        targetUserId: fixtureCaseDetails[0].userId,
                      } satisfies ModerationActionRequestSummary,
                    ]
                  : []),
              ],
              policy: currentPolicy,
              loadedAt: `read-${revision}`,
            },
          };
        case 'submitted_report':
          return {
            kind: 'submitted_report',
            item: { ...currentItem, kind: 'submitted_report' },
            policy: currentPolicy,
            report: wrongPayload
              ? { ...fixtureReportDetails[0], id: 'foreign-report', guildId: 'other-guild' }
              : fixtureReportDetails[0],
            requests,
          };
        case 'observed_alert':
          return {
            kind: 'observed_alert',
            item: { ...currentItem, kind: 'observed_alert' },
            policy: currentPolicy,
            requests,
            detection: {
              id: currentItem.sourceId,
              detectionType: 'message_analysis',
              detectedAt: null,
              confidence: 0.91,
              reasons: ['Complete detection source text'],
              latestCaseId: null,
              accounting: {
                excluded: false,
                scope: null,
                reason: null,
                excludedBy: null,
                excludedAt: null,
              },
              observedAction: null,
              observedActionAt: null,
              observedActionBy: null,
              sourceChannelId: null,
              sourceMessageId: null,
              sourceMessageUrl: null,
            },
          };
        case 'report_attention':
          return {
            kind: 'report_attention',
            item: { ...currentItem, kind: 'report_attention' },
            policy: currentPolicy,
            intake: fixtureReportDetails[0],
            reply: {
              kind: 'available',
              message: {
                id: 'reply-1',
                channelId: 'thread-1',
                authorLabel: 'juniper',
                content: 'Complete reply with\nnewlines and trailing source text.',
                timestamp: '2026-10-25T12:00:00Z',
                url: 'https://discord.com/channels/guild-1/thread-1/reply-1',
                attachments: [
                  {
                    id: 'attachment',
                    filename: 'proof.png',
                    url: 'https://example.com/proof.png',
                    contentType: 'image/png',
                  },
                ],
              },
            },
          };
        case 'support_attention':
          return {
            kind: 'support_attention',
            item: { ...currentItem, kind: 'support_attention' },
            policy: currentPolicy,
            subtype: 'recovery_reply',
            caseData: null,
            reply: {
              kind: 'unavailable',
              sourceUrl: 'https://discord.com/channels/guild-1/thread-1/reply-2',
            },
          };
        case 'pending_screening':
          return {
            kind: 'pending_screening',
            item: { ...currentItem, kind: 'pending_screening' },
            policy: currentPolicy,
            screening: { pendingSince: null, thresholdDays: 7, lastCheckedAt: null },
          };
      }
    },
    [revision, wrongIdentity, wrongPayload, responseLoss]
  );
  const complete: WorkspaceActions['observedAction'] = async (_input, data) => {
    if (data.get('confirmAction') !== 'on') throw new Error('Confirmation missing');
    setSubmissions((value) => value + 1);
    if (responseLoss) throw new Error('Lost response');
    done.current = true;
    setSummaries((previous) => previous.filter((item) => item.id !== observed.id));
    return { kind: 'request', receipt: { id: request.id, status: 'completed' } };
  };
  const actions: WorkspaceActions = {
    observedAction: complete,
    caseAction: async (input, form) => {
      if (form.get('confirmAction') !== 'on') throw new Error('Confirmation missing');
      setSubmissions((value) => value + 1);
      if (input.action === 'refresh_notification')
        caseRequest.current = {
          ...request,
          id: 'case-result',
          status: 'queued',
          actionType: 'refresh_case_notification',
          requestedAction: input.action,
          verificationEventId: input.caseId,
          detectionEventId: null,
          targetUserId: fixtureCaseDetails[0].userId,
        };
      return { kind: 'request', receipt: { id: 'case-result', status: 'queued' } };
    },
    reportAction: async () => ({ kind: 'failed', message: 'Story report response unavailable' }),
    attentionAction: async ({ queueItemId }) => ({
      kind: 'attention',
      result: {
        status: 'acknowledged',
        itemId: queueItemId,
        actor: { id: 'moderator', surface: 'web' },
      },
    }),
  };
  return (
    <WorkspaceShell
      guildId="guild-1"
      guildName="Example server"
      sessionUsername="moderator"
      currentPage="inbox"
    >
      <div style={{ padding: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            disabled.current = true;
            setRevision((value) => value + 1);
          }}
        >
          Revoke selected eligibility
        </button>
        <button
          onClick={() =>
            setSummaries((previous) => previous.filter((item) => item.id !== observed.id))
          }
        >
          Remove observed row
        </button>
        <button
          onClick={() => {
            if (caseRequest.current)
              caseRequest.current = {
                ...caseRequest.current,
                status: 'completed',
                updatedAt: '2026-10-25T12:00:03Z',
                completedAt: '2026-10-25T12:00:03Z',
              };
            setRevision((value) => value + 1);
          }}
        >
          Complete case request
        </button>
        <span data-testid="submissions">{submissions}</span>
        <span data-testid="refreshes">{refreshes}</span>
      </div>
      <InboxWorkspace
        guildId="guild-1"
        items={summaries}
        initialLocation={initialLocation}
        loadDetail={loadDetail}
        actions={actions}
      />
    </WorkspaceShell>
  );
}
// The browser suite audits every source after its asynchronous read completes.
// Keep addon scans manual so two axe runs cannot race on the same document.
const meta = {
  title: 'Moderation workspace/Inbox controller',
  component: Runnable,
  globals: { a11y: { manual: true } },
} satisfies Meta<typeof Runnable>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Mixed: Story = {};
export const Empty: Story = { args: { empty: true } };
export const WrongIdentity: Story = { args: { wrongIdentity: true } };

export const WrongPayload: Story = { args: { wrongPayload: true } };
export const ResponseLoss: Story = { args: { responseLoss: true } };
