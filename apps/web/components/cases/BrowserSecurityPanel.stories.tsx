import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CaptchaChallengeSummary } from '@drasil/contracts';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { CaseWorkspaceView } from './CaseWorkspaceView';
import { CaseTools } from './CaseTools';

const original: CaptchaChallengeSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  method: 'turnstile',
  methodRevision: 2,
  generation: 2,
  status: 'failed',
  requestSource: 'moderator',
  passEffect: 'evidence_only',
  requestedAt: '2026-10-25T11:00:00Z',
  deliveredAt: '2026-10-25T11:01:00Z',
  deliveryErrorCode: null,
  expiresAt: '2026-10-25T12:00:00Z',
  submissionCount: 5,
  passedAt: null,
  bypassedAt: null,
  bypassedBy: null,
  bypassReason: null,
};
const policy: CaseWorkspaceData['policy'] = {
  allowedActions: ['challenge_user', 'retry_captcha', 'bypass_captcha'],
  canQueueCaseActions: true,
  canOpenReportCases: false,
  canManageCleanup: false,
  kickReasonRequired: true,
  banReasonRequired: true,
};
type Mode =
  | 'failed'
  | 'pending'
  | 'delivery-failed'
  | 'not-issued'
  | 'expired'
  | 'cancelled'
  | 'bypassed'
  | 'passed'
  | 'automatic'
  | 'absent'
  | 'image'
  | 'response-loss';
function Interaction({ mode = 'failed' }: { readonly mode?: Mode }) {
  const [challenge, setChallenge] = useState<CaptchaChallengeSummary | null>(() =>
    mode === 'not-issued'
      ? null
      : {
          ...original,
          ...(mode === 'pending' || mode === 'delivery-failed'
            ? { status: 'pending' as const }
            : {}),
          ...(mode === 'expired' || mode === 'cancelled' || mode === 'bypassed'
            ? { status: mode }
            : {}),
          ...(mode === 'bypassed'
            ? {
                bypassedBy: 'moderator-2',
                bypassedAt: '2026-10-25T11:10:00Z',
                bypassReason: 'Reviewed directly with the member',
              }
            : {}),
          ...(mode === 'delivery-failed'
            ? { deliveredAt: null, deliveryErrorCode: 'cannot_dm_user' }
            : {}),
          ...(mode === 'passed' || mode === 'automatic'
            ? { status: 'passed' as const, passedAt: '2026-10-25T11:05:00Z' }
            : {}),
          ...(mode === 'automatic'
            ? {
                requestSource: 'automatic_suspicious_join' as const,
                passEffect: 'verify_join_only' as const,
              }
            : {}),
          ...(mode === 'image' ? { method: 'discord_image' as const } : {}),
        }
  );
  const [configuration, setConfiguration] = useState<
    CaseWorkspaceData['securityCheckConfiguration']
  >({ method: 'turnstile', methodRevision: 2 });
  const [requests, setRequests] = useState<readonly ModerationActionRequestSummary[]>([]);
  const [loadedAt, setLoadedAt] = useState('2026-10-25T12:00:00Z');
  const [payload, setPayload] = useState('');
  const [count, setCount] = useState(0);
  const detail: CaseWorkspaceData['detail'] = {
    ...fixtureCaseDetails[0],
    caseKind: 'standard',
    status: 'pending',
    presenceState: mode === 'absent' ? 'left_or_removed' : 'in_server',
    allowedActions: ['challenge_user', 'retry_captcha', 'bypass_captcha'],
    captchaChallenge: challenge,
  };
  const data: CaseWorkspaceData = {
    securityCheckConfiguration: configuration,
    actorUserId: 'moderator-1',
    detail,
    policy,
    requests,
    loadedAt,
    membership: null,
    report: null,
    cleanup: null,
  };
  useEffect(() => {
    const update: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      const patch = event.detail;
      if (patch === 'configuration')
        setConfiguration({ method: 'discord_image', methodRevision: 8 });
      if (patch === 'unknown-configuration') setConfiguration(null);
      if (patch === 'generation')
        setChallenge((value) => value && { ...value, generation: value.generation + 1 });
      if (patch === 'method')
        setChallenge((value) => value && { ...value, method: 'discord_image' });
      if (patch === 'revision')
        setChallenge((value) => value && { ...value, methodRevision: value.methodRevision + 1 });
      if (patch === 'read') setLoadedAt(new Date().toISOString());
      if (patch === 'delivered')
        setChallenge((value) => value && { ...value, status: 'pending', deliveryErrorCode: null });
      if (patch === 'passed')
        setChallenge(
          (value) => value && { ...value, status: 'passed', passedAt: '2026-10-25T11:05:00Z' }
        );
      if (patch === 'complete') {
        setRequests((values) =>
          values.map((value) => ({
            ...value,
            status: 'completed',
            completedAt: '2026-10-25T12:01:00Z',
            updatedAt: '2026-10-25T12:01:00Z',
            resultSummary: 'Security-check action recorded.',
          }))
        );
      }
      if (patch === 'unrelated') {
        setRequests([request('bypass_captcha', 9)]);
      }
      if (patch === 'unrelated-configuration')
        setRequests([
          {
            ...request('retry_captcha', 2),
            captchaConfiguration: { method: 'discord_image', methodRevision: 8 },
          },
        ]);
      if (patch === 'matching-retry') setRequests([request('retry_captcha', 2)]);
      if (patch === 'matching') setRequests([request('bypass_captcha', 2)]);
    };
    window.addEventListener('fixture:security', update);
    return () => window.removeEventListener('fixture:security', update);
  }, []);
  function request(action: string, generation: number): ModerationActionRequestSummary {
    return {
      id: `request-${action}-${generation}`,
      actionType:
        action === 'bypass_captcha'
          ? 'bypass_captcha_challenge'
          : action === 'retry_captcha'
            ? 'retry_captcha_challenge'
            : 'request_captcha_challenge',
      actorSurface: 'web',
      actorUserId: 'moderator-1',
      status: 'queued',
      requestedAt: '2026-10-25T12:00:00Z',
      updatedAt: '2026-10-25T12:00:00Z',
      targetUserId: detail.userId,
      verificationEventId: detail.id,
      detectionEventId: null,
      reportIntakeId: null,
      requestedAction: action,
      resultSummary: null,
      completedAt: null,
      failedAt: null,
      lastError: null,
      messageDeletionJobId: null,
      captchaBinding: { challengeId: original.id, generation },
      ...(action !== 'bypass_captcha' && configuration && configuration.method !== 'none'
        ? {
            captchaConfiguration: {
              method: configuration.method,
              methodRevision: configuration.methodRevision,
            },
          }
        : {}),
    };
  }
  const actions: WorkspaceActions = {
    caseAction: async (input, form) => {
      setCount((value) => value + 1);
      setPayload(JSON.stringify({ ...input, fields: Object.fromEntries(form.entries()) }));
      if (mode === 'response-loss') throw new Error('Synthetic response loss');
      const item = request(input.action, Number(form.get('expectedCaptchaGeneration')) || 1);
      setRequests([item]);
      return { kind: 'request', receipt: { id: item.id, status: item.status } };
    },
    observedAction: async () => ({ kind: 'failed', message: 'unused' }),
    reportAction: async () => ({ kind: 'failed', message: 'unused' }),
    attentionAction: async () => ({ kind: 'failed', message: 'unused' }),
  };
  return (
    <WorkspaceShell
      guildId="guild-1"
      guildName="Example server"
      sessionUsername="Moderator"
      currentPage="cases"
    >
      <InboxActionRequestPollingProvider enabled={false} serverRequests={requests}>
        <CaseWorkspaceView
          data={data}
          actionArea={<p>Case open · Moderator review</p>}
          returnHref="/admin/guild/guild-1/inbox?item=case:case-stale"
          tools={
            <CaseTools
              data={data}
              actions={actions}
              returnHref="/admin/guild/guild-1/inbox?item=case:case-stale"
            />
          }
          conversation={null}
        />
      </InboxActionRequestPollingProvider>
      <span data-testid="submission-count">{count}</span>
      <pre data-testid="submitted-payload">{payload}</pre>
    </WorkspaceShell>
  );
}
const meta = { title: 'Workspace/Browser security', component: Interaction } satisfies Meta<
  typeof Interaction
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Failed: Story = {};
export const Pending: Story = { args: { mode: 'pending' } };
export const DeliveryFailed: Story = { args: { mode: 'delivery-failed' } };
export const NotIssued: Story = { args: { mode: 'not-issued' } };
export const Expired: Story = { args: { mode: 'expired' } };
export const Cancelled: Story = { args: { mode: 'cancelled' } };
export const Bypassed: Story = { args: { mode: 'bypassed' } };
export const Passed: Story = { args: { mode: 'passed' } };
export const Automatic: Story = { args: { mode: 'automatic' } };
export const Absent: Story = { args: { mode: 'absent' } };
export const Image: Story = { args: { mode: 'image' } };
export const ResponseLoss: Story = { args: { mode: 'response-loss' } };
