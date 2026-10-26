import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  getMessageCleanupExecutionEligibility,
  messageCleanupJobDetailSchema,
  messageCleanupJobModeSchema,
  messageCleanupScopeSchema,
  type MessageCleanupJobDetail,
} from '@drasil/contracts';
import type { InboxStateAction } from '@/components/inbox/InboxActionForm';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import {
  fixtureMessageCleanupJobDetails,
  fixtureMessageCleanupCaseWorkspaces,
} from '@/lib/messageCleanupFixtures';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { ConfirmedAction } from '@/components/workspace/actions/ConfirmedAction';
import { MessageCleanupPanel } from './MessageCleanupPanel';

type Scenario =
  | 'ready'
  | 'combined'
  | 'finalization'
  | 'new'
  | 'denied'
  | 'indexing'
  | 'partial'
  | 'too-many'
  | 'non-admin'
  | 'response-loss'
  | 'outcomes';
function validated(value: MessageCleanupJobDetail): MessageCleanupJobDetail {
  return messageCleanupJobDetailSchema.parse({
    ...value,
    execution: getMessageCleanupExecutionEligibility({
      ...value,
      candidateCount: value.outcomes.candidateCount,
    }),
  });
}
function initial(scenario: Scenario): MessageCleanupJobDetail {
  const source = fixtureMessageCleanupJobDetails[0];
  if (scenario === 'finalization') return validated(fixtureMessageCleanupJobDetails[1]);
  if (scenario === 'combined')
    return validated({ ...source, mode: 'ban_with_cleanup', caseFinalizationStatus: 'pending' });
  if (scenario === 'denied' || scenario === 'indexing')
    return validated({ ...source, coverage: scenario, scope: 'last_day' });
  if (scenario === 'partial') return validated({ ...source, scope: 'last_day' });
  if (scenario === 'too-many')
    return validated({
      ...source,
      coverage: 'too_many',
      scope: 'last_day',
      outcomes: { ...source.outcomes, candidateCount: 101 },
    });
  if (scenario === 'outcomes')
    return validated({
      ...source,
      status: 'completed',
      outcomes: {
        candidateCount: 6,
        preservedCount: 3,
        deletedCount: 1,
        alreadyMissingCount: 1,
        changedSincePreviewCount: 1,
        evidenceFailedCount: 1,
        deleteFailedCount: 1,
        permissionDeniedCount: 1,
      },
      items: (
        [
          'deleted',
          'already_missing',
          'changed_since_preview',
          'evidence_failed',
          'delete_failed',
          'permission_denied',
        ] as const
      ).map((status, index) => ({ ...source.items[0], id: `outcome-${index}`, status })),
    });
  return validated(source);
}
function Interaction({ scenario = 'ready' }: { readonly scenario?: Scenario }) {
  const [job, setJob] = useState(() => initial(scenario));
  const [hasPreview, setHasPreview] = useState(scenario !== 'new');
  const previewBinding = useRef<Pick<MessageCleanupJobDetail, 'mode' | 'scope' | 'reason'> | null>(
    null
  );
  const [requests, setRequests] = useState<readonly ModerationActionRequestSummary[]>([]);
  const [loadedAt, setLoadedAt] = useState('2026-10-25T12:00:00Z');
  const [payloads, setPayloads] = useState<unknown[]>([]);
  const [canManage, setCanManage] = useState(scenario !== 'non-admin');
  const lastRequest = useRef<ModerationActionRequestSummary | null>(null);
  const [readCount, setReadCount] = useState(0);
  const count = useRef(0);
  useEffect(() => {
    const listener = (event: Event) => {
      const change = (event as CustomEvent<string>).detail;
      if (change === 'count')
        setJob((previous) =>
          validated({
            ...previous,
            outcomes: { ...previous.outcomes, candidateCount: 2 },
            items: [...previous.items, { ...previous.items[0], id: 'new-item' }],
          })
        );
      if (change === 'generation')
        setJob((previous) => ({ ...previous, previewedAt: '2026-10-25T12:01:00Z' }));
      if (change === 'read') {
        setReadCount((value) => value + 1);
        setLoadedAt(new Date().toISOString());
      }
      if (change === 'preview-complete' && lastRequest.current && previewBinding.current) {
        const request = lastRequest.current;
        const binding = previewBinding.current;
        setRequests([{ ...request, status: 'completed', updatedAt: new Date().toISOString() }]);
        setJob((previous) =>
          validated({
            ...previous,
            ...binding,
            id: request.messageDeletionJobId!,
            status: 'ready',
            coverage: 'ready',
          })
        );
        setHasPreview(true);
        setLoadedAt(new Date().toISOString());
      }
      if (change === 'permission') setCanManage(false);
      if (change === 'unrelated' && lastRequest.current)
        setRequests([
          {
            ...lastRequest.current,
            id: 'other-request',
            cleanupIntentToken: 'other-intent',
            messageDeletionJobId: 'other-job',
          },
        ]);
      if (change === 'same-job-other-intent' && lastRequest.current)
        setRequests([
          {
            ...lastRequest.current,
            id: 'other-intent-request',
            cleanupIntentToken: 'other-intent',
          },
        ]);
      if (change === 'recover' && lastRequest.current) setRequests([lastRequest.current]);
      if (change === 'failed' && lastRequest.current)
        setRequests([
          {
            ...lastRequest.current,
            status: 'failed',
            lastError: 'Discord rejected message deletion.',
            updatedAt: new Date().toISOString(),
          },
        ]);
      if (change === 'finish' && lastRequest.current) {
        setRequests([
          {
            ...lastRequest.current,
            status: 'failed',
            lastError: 'Case finalization failed.',
            updatedAt: new Date().toISOString(),
          },
        ]);
        setJob((previous) =>
          validated({
            ...previous,
            status: 'completed',
            banStatus: 'succeeded',
            caseFinalizationStatus: 'failed',
            outcomes: { ...previous.outcomes, deletedCount: 1 },
          })
        );
      }
      if (change === 'finalized' && lastRequest.current) {
        setRequests([
          { ...lastRequest.current, status: 'completed', updatedAt: new Date().toISOString() },
        ]);
        setJob((previous) => validated({ ...previous, caseFinalizationStatus: 'succeeded' }));
      }
    };
    window.addEventListener('fixture:cleanup', listener);
    return () => window.removeEventListener('fixture:cleanup', listener);
  }, []);
  const action =
    (actionType: ModerationActionRequestSummary['actionType']): InboxStateAction =>
    async (_previous, form) => {
      const fields = Object.fromEntries(form.entries());
      count.current += 1;
      setPayloads((previous) => [...previous, { actionType, fields }]);
      const request: ModerationActionRequestSummary = {
        id: `actual-request-${count.current}`,
        actionType,
        actorSurface: 'web_case',
        actorUserId: 'admin-2',
        completedAt: null,
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: String(fields.jobId ?? 'new-preview-job'),
        requestedAt: '2026-10-25T12:00:00Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: null,
        status: 'queued',
        targetUserId: job.targetUserId,
        verificationEventId: job.verificationEventId,
        updatedAt: '2026-10-25T12:00:00Z',
        cleanupIntentToken: String(fields.idempotencyKey),
      };
      if (actionType === 'preview_case_message_deletion')
        previewBinding.current = {
          mode: messageCleanupJobModeSchema.parse(fields.mode),
          scope: messageCleanupScopeSchema.parse(fields.scope),
          reason: String(fields.reason),
        };
      lastRequest.current = request;
      if (scenario === 'response-loss') throw new Error('Response lost');
      setRequests([request]);
      return { requestId: request.id, status: request.status, message: 'Queued' };
    };
  const integration = {
    workspace: {
      ...fixtureMessageCleanupCaseWorkspaces[0],
      latestJobs: hasPreview ? [job] : [],
      ...(scenario === 'finalization'
        ? {
            caseStatus: 'banned' as const,
            canPreview: false,
            blockedReason: 'case_not_pending' as const,
          }
        : {}),
    },
    deleteOnlyJob: hasPreview && job.mode === 'delete_only' ? job : null,
    combinedJob: hasPreview && job.mode === 'ban_with_cleanup' ? job : null,
    previewAction: action('preview_case_message_deletion'),
    executeAction: action('execute_case_message_deletion'),
    combinedBanAction: action('ban_case_user_with_message_cleanup'),
    requests,
    loadedAt,
    returnHref: '/admin/guild/guild-1/inbox?item=case:case-stale',
    channelNames: { 'source-channel-1': 'General' },
  };
  return (
    <WorkspaceShell
      guildId="guild-1"
      guildName="Fixture Guild"
      sessionUsername="Moderator"
      currentPage="inbox"
    >
      <InboxActionRequestPollingProvider enabled serverRequests={requests}>
        <ConfirmedAction
          target={{
            kind: 'case',
            guildId: 'guild-1',
            recordId: job.verificationEventId,
            targetUserId: job.targetUserId,
            label: `Member ${job.targetUserId}`,
            loadedAt,
          }}
          action={{
            id: 'ban_user',
            label: 'Ban member',
            description: 'Ban this member without message cleanup.',
            reasonRequired: true,
          }}
          durableRequest={null}
          submit={async (form) => {
            const receipt = await action('ban_case_user')(
              { status: 'idle', message: null, requestId: null },
              form
            );
            return { kind: 'request', receipt: { id: receipt.requestId!, status: 'queued' } };
          }}
        />
        <MessageCleanupPanel
          integration={integration}
          policy={{
            allowedActions: scenario === 'finalization' ? [] : ['ban_user'],
            canManageCleanup: canManage,
            canQueueCaseActions: true,
            canOpenReportCases: false,
            kickReasonRequired: true,
            banReasonRequired: true,
          }}
        />
        <output data-testid="submission-count">{payloads.length}</output>
        <pre data-testid="submitted-payloads">{JSON.stringify(payloads)}</pre>
        <output data-testid="read-count">{readCount}</output>
      </InboxActionRequestPollingProvider>
    </WorkspaceShell>
  );
}
const meta = { title: 'Workspace/Message Cleanup', component: Interaction } satisfies Meta<
  typeof Interaction
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Combined: Story = { args: { scenario: 'combined' } };
export const Finalization: Story = { args: { scenario: 'finalization' } };
export const NewPreview: Story = { args: { scenario: 'new' } };
export const Denied: Story = { args: { scenario: 'denied' } };
export const Indexing: Story = { args: { scenario: 'indexing' } };
export const PartialWindow: Story = { args: { scenario: 'partial' } };
export const TooMany: Story = { args: { scenario: 'too-many' } };
export const NonAdmin: Story = { args: { scenario: 'non-admin' } };
export const ResponseLoss: Story = { args: { scenario: 'response-loss' } };
export const Outcomes: Story = { args: { scenario: 'outcomes' } };
