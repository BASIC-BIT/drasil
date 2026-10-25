import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import { fixtureCaseDetails, fixtureParkedCaseDetails } from '@/lib/caseFixtures';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { InboxItemDetail } from '@/components/inbox/InboxItemDetail';
import { CaseWorkspaceView } from './CaseWorkspaceView';
import { CaseTools } from './CaseTools';

const policy: CaseWorkspaceData['policy'] = {
  allowedActions: ['quarantine_compromised_account', 'verify_user', 'kick_user', 'ban_user'],
  canQueueCaseActions: true,
  canManageCleanup: false,
  canOpenReportCases: false,
  kickReasonRequired: true,
  banReasonRequired: true,
};
function preview(id = 'preview-1', age = 60000): ModerationActionRequestSummary {
  const at = new Date(Date.now() - age).toISOString();
  return {
    id,
    actorUserId: 'moderator-1',
    actorSurface: 'web',
    actionType: 'preview_account_quarantine',
    verificationEventId: fixtureCaseDetails[0].id,
    targetUserId: fixtureCaseDetails[0].userId,
    detectionEventId: null,
    reportIntakeId: null,
    requestedAction: 'quarantine_compromised_account',
    requestedAt: at,
    completedAt: at,
    updatedAt: at,
    failedAt: null,
    lastError: null,
    messageDeletionJobId: null,
    status: 'completed',
    resultSummary: null,
    accountQuarantinePreview: {
      enabled: true,
      canContain: false,
      caseRoleReady: true,
      caseRole: { roleId: 'case-role', roleName: 'Case', reason: null },
      plannedRoles: [{ roleId: 'member-role', roleName: 'Member', reason: null }],
      privilegedRoles: [],
      retainedRoles: [
        { roleId: 'managed-role', roleName: 'Managed', reason: 'Integration-managed role' },
      ],
      previewedAt: at,
      recoveryThreadId: 'recovery-thread',
      recoveryThreadReady: true,
      adminNotificationReady: true,
      lockdownErrorCount: 0,
      lockdownIssueCount: 1,
      lockdownPlannedActionCount: 0,
      memberBypassCount: 1,
      unremovablePrivilegeReasons: ['A retained integration role has elevated permissions.'],
    },
  };
}
function Interaction({
  mode = 'fresh',
}: {
  readonly mode?: 'fresh' | 'empty' | 'stale' | 'parked' | 'breach' | 'reply' | 'live-stale';
}) {
  const [requests, setRequests] = useState<readonly ModerationActionRequestSummary[]>(() =>
    mode === 'empty' || mode === 'parked' || mode === 'breach' || mode === 'reply'
      ? []
      : [preview('preview-1', mode === 'stale' ? 600000 : 60000)]
  );
  const [loadedAt, setLoadedAt] = useState(new Date().toISOString());
  const [payload, setPayload] = useState('');
  const [count, setCount] = useState(0);
  const [partial, setPartial] = useState(false);
  const parked = mode === 'parked' || mode === 'breach' || mode === 'reply';
  const base = parked ? fixtureParkedCaseDetails[0] : fixtureCaseDetails[0];
  const detail = {
    ...base,
    caseKind: 'compromised_account',
    allowedActions: [
      'quarantine_compromised_account',
      'verify_user',
      'kick_user',
      'ban_user',
      'close_no_action',
    ],
    ...(partial
      ? {
          containmentStatus: 'incomplete',
          attentionState: 'review_required',
          quarantineEffects: {
            removedRoleCount: 1,
            retainedRoleCount: 1,
            failedRoleCount: 1,
            memberBypassCount: 1,
          },
        }
      : {}),
  } satisfies CaseWorkspaceData['detail'];
  const data: CaseWorkspaceData = {
    actorUserId: 'moderator-1',
    detail,
    report: null,
    membership: null,
    requests,
    cleanup: null,
    policy,
    loadedAt,
  };
  useEffect(() => {
    const replace = () => {
      setRequests((values) => [preview('preview-2'), ...values]);
      setLoadedAt(new Date().toISOString());
    };
    const completeRead = () => setLoadedAt(new Date().toISOString());
    window.addEventListener('fixture:replace-preview', replace);
    window.addEventListener('fixture:completed-read', completeRead);
    return () => {
      window.removeEventListener('fixture:replace-preview', replace);
      window.removeEventListener('fixture:completed-read', completeRead);
    };
  }, []);
  const actions: WorkspaceActions = {
    caseAction: async (input, form) => {
      setCount((value) => value + 1);
      setPayload(JSON.stringify({ ...input, fields: Object.fromEntries(form.entries()) }));
      const previous = preview();
      const phase = form.get('quarantinePhase');
      const request: ModerationActionRequestSummary = {
        ...previous,
        id: phase === 'preview' ? 'preview-queued' : 'execution-1',
        actionType:
          phase === 'preview'
            ? 'preview_account_quarantine'
            : input.action === 'verify_user'
              ? 'verify_case_user'
              : 'quarantine_compromised_account',
        accountQuarantinePreview: null,
        accountQuarantinePreviewRequestId: String(form.get('previewRequestId') ?? ''),
        status: 'queued',
        completedAt: null,
        verificationEventId: input.caseId,
        targetUserId: detail.userId,
      };
      setRequests((values) => [request, ...values]);
      setTimeout(() => {
        if (phase === 'preview')
          setRequests((values) => [
            preview(request.id, 0),
            ...values.filter((value) => value.id !== request.id),
          ]);
        else {
          setRequests((values) =>
            values.map((value) =>
              value.id === request.id
                ? {
                    ...value,
                    status: mode === 'live-stale' ? 'failed' : 'completed',
                    lastError:
                      mode === 'live-stale'
                        ? 'Saved preview no longer matches the member or server.'
                        : null,
                    completedAt: new Date().toISOString(),
                    resultSummary: 'Containment incomplete: 1 role removed; 1 removal failed.',
                  }
                : value
            )
          );
          if (mode !== 'live-stale') setPartial(true);
        }
        setLoadedAt(new Date().toISOString());
      }, 1500);
      return {
        kind: 'request',
        receipt: { id: request.id, status: 'queued', messageDeletionJobId: null },
      };
    },
    attentionAction: async (input, form) => {
      setCount((value) => value + 1);
      setPayload(JSON.stringify({ ...input, fields: Object.fromEntries(form.entries()) }));
      return {
        kind: 'attention',
        result: {
          status: 'acknowledged',
          itemId: input.queueItemId,
          actor: { id: 'moderator-1', surface: 'web' },
        },
      };
    },
    reportAction: async () => ({ kind: 'failed', message: 'unused' }),
    observedAction: async () => ({ kind: 'failed', message: 'unused' }),
  };
  const attention = mode === 'breach' || mode === 'reply';
  return (
    <WorkspaceShell
      guildId="guild-1"
      guildName="Example server"
      sessionUsername="Moderator"
      currentPage="cases"
    >
      <InboxActionRequestPollingProvider enabled serverRequests={requests}>
        {attention ? (
          <InboxItemDetail
            detail={{
              kind: 'support_attention',
              subtype: mode === 'breach' ? 'quarantine_breach' : 'recovery_reply',
              caseData: data,
              reply: {
                kind: 'unavailable',
                sourceUrl: `https://discord.com/channels/guild-1/${mode === 'breach' ? 'breach-channel' : 'recovery-thread'}/message-1`,
              },
              policy: { ...policy, allowedActions: ['acknowledge'] },
              item: {
                id: `queue:${mode}-1`,
                kind: 'support_attention',
                guildId: 'guild-1',
                sourceId: detail.id,
                queueItemId: `${mode}-1`,
                subject: {
                  userId: detail.userId,
                  displayLabel: detail.userIdentity.displayLabel,
                  secondaryLabel: null,
                  avatarUrl: null,
                },
                title:
                  mode === 'breach' ? 'Containment breach in general' : 'Account recovery reply',
                summary: null,
                summarySource: 'other',
                statusLabel: 'review_required',
                signalLabel: null,
                stale: false,
                staleHours: 0,
                createdAt: null,
                updatedAt: null,
                detailHref: null,
                links: [],
                allowedActions: ['acknowledge'],
              },
            }}
            loadedAt={loadedAt}
            returnHref={`/admin/guild/guild-1/inbox?item=queue:${mode}-1`}
            trackedRequestId={null}
            onTrackedRequest={() => {}}
            actions={actions}
          />
        ) : (
          <CaseWorkspaceView
            data={data}
            returnHref="/admin/guild/guild-1/inbox?item=case:case-stale"
            actionArea={<p>Compromised account · {detail.userId}</p>}
            tools={
              <CaseTools
                data={data}
                actions={actions}
                returnHref="/admin/guild/guild-1/inbox?item=case:case-stale"
              />
            }
            conversation={null}
          />
        )}
      </InboxActionRequestPollingProvider>
      <span data-testid="submission-count">{count}</span>
      <pre data-testid="submitted-payload">{payload}</pre>
    </WorkspaceShell>
  );
}
const meta = {
  title: 'Moderation workspace/Account quarantine',
  parameters: { layout: 'fullscreen' },
  render: () => <Interaction />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Fresh: Story = {};
export const Empty: Story = { render: () => <Interaction mode="empty" /> };
export const Stale: Story = { render: () => <Interaction mode="stale" /> };
export const Parked: Story = { render: () => <Interaction mode="parked" /> };
export const Breach: Story = { render: () => <Interaction mode="breach" /> };
export const Reply: Story = { render: () => <Interaction mode="reply" /> };

export const LiveStateChanged: Story = { render: () => <Interaction mode="live-stale" /> };
