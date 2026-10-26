import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Foundation } from '../Foundation';
import { ConfirmedAction } from './ConfirmedAction';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';

const request: ModerationActionRequestSummary = {
  id: 'request-1',
  actionType: 'ban_observed_detection',
  actorSurface: 'web',
  completedAt: null,
  detectionEventId: 'detection-1',
  failedAt: null,
  lastError: null,
  messageDeletionJobId: null,
  requestedAt: '2026-10-25T12:00:00Z',
  reportIntakeId: null,
  requestedAction: 'ban_user',
  resultSummary: null,
  status: 'processing',
  targetUserId: 'member-1',
  updatedAt: '2026-10-25T12:00:00Z',
  verificationEventId: null,
};
const storageKey = 'workspace-action-story-pending';
function Interaction({
  mode = 'interactive',
  surface = 'observed_alert',
  deferFirstRefresh = false,
}: {
  readonly mode?: 'interactive' | 'empty' | 'pending';
  readonly surface?: 'case' | 'observed_alert';
  readonly deferFirstRefresh?: boolean;
}) {
  const matchingRequest: ModerationActionRequestSummary =
    surface === 'case'
      ? {
          ...request,
          actionType: 'ban_case_user',
          detectionEventId: null,
          verificationEventId: 'case-1',
        }
      : request;
  const [show, setShow] = useState(true);
  const [count, setCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [durable, setDurable] = useState<ModerationActionRequestSummary | null>(() =>
    mode === 'pending' && sessionStorage.getItem(storageKey) ? request : null
  );
  const [loadedAt, setLoadedAt] = useState('first-read');
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    let sequence = 0;
    let requested = 0;
    const refresh = (): void => {
      if (deferFirstRefresh && requested++ === 0) return;
      // Each completion models a finished read, including an empty durable result.
      setTimeout(() => {
        setLoadedAt(`completed-read-${++sequence}`);
        setRefreshCount((value) => value + 1);
        if (mode === 'pending' && sessionStorage.getItem(storageKey)) setDurable(request);
        if (mode === 'empty') setDurable(null);
      }, 100);
    };
    const changed = (): void => setDisabled(true);
    const restored = (): void => setDisabled(false);
    window.addEventListener('storybook:router-refresh', refresh);
    window.addEventListener('fixture:eligibility-changed', changed);
    window.addEventListener('fixture:eligibility-restored', restored);
    return () => {
      window.removeEventListener('storybook:router-refresh', refresh);
      window.removeEventListener('fixture:eligibility-changed', changed);
      window.removeEventListener('fixture:eligibility-restored', restored);
    };
  }, [mode, deferFirstRefresh]);
  return (
    <Foundation>
      <div style={{ maxWidth: 720, padding: 32 }}>
        <h1>Observed alert</h1>
        <p>Repeated links in #general</p>
        {show ? (
          <InboxActionRequestPollingProvider enabled serverRequests={durable ? [durable] : []}>
            <ConfirmedAction
              target={{
                guildId: 'guild-1',
                kind: surface,
                recordId: surface === 'case' ? 'case-1' : 'detection-1',
                targetUserId: 'member-1',
                label: 'Member one',
                loadedAt,
              }}
              action={{
                id: 'ban_user',
                tone: 'danger',
                label: 'Ban member',
                description: 'Ban Member one from this server. No message deletion requested.',
                reasonRequired: true,
                disabled,
              }}
              durableRequest={durable}
              submit={async () => {
                setCount((value) => value + 1);
                if (mode !== 'interactive') {
                  if (mode === 'pending') sessionStorage.setItem(storageKey, 'pending');
                  await fetch('/workspace-actions-response');
                  throw new Error('Response unavailable');
                }
                setTimeout(
                  () =>
                    setDurable({
                      ...matchingRequest,
                      status: 'completed',
                      updatedAt: '2026-10-25T12:00:02Z',
                    }),
                  1_000
                );
                return { kind: 'request', receipt: { id: request.id, status: 'queued' } };
              }}
            />
          </InboxActionRequestPollingProvider>
        ) : null}
        <button onClick={() => setShow(false)}>Leave action area</button>
        <label>
          Reading notes
          <textarea aria-label="Reading notes" />
        </label>
        <span data-testid="submission-count">{count}</span>
        <span data-testid="refresh-count">{refreshCount}</span>
        <button
          onClick={() =>
            setDurable({ ...request, id: 'unrelated', detectionEventId: 'other-detection' })
          }
        >
          Supply irrelevant request
        </button>
      </div>
    </Foundation>
  );
}
const meta = { title: 'Workspace/Actions/Confirmed action', component: Interaction } satisfies Meta<
  typeof Interaction
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Interactive: Story = {};
export const ResponseLossEmpty: Story = { args: { mode: 'empty' } };
export const ResponseLossPending: Story = { args: { mode: 'pending' } };

export const CaseIntent: Story = { args: { surface: 'case' } };

export const ResponseLossPendingManual: Story = {
  args: { mode: 'pending', deferFirstRefresh: true },
};

function RequestLifecycle({ failedReceipt = false }: { readonly failedReceipt?: boolean }) {
  const [recordId, setRecordId] = useState('detection-1');
  const [revision, setRevision] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [durable, setDurable] = useState<ModerationActionRequestSummary | null>(
    failedReceipt ? { ...request, id: 'request-a', status: 'failed' } : null
  );
  useEffect(() => {
    const refresh = (): void => setRefreshCount((count) => count + 1);
    window.addEventListener('storybook:router-refresh', refresh);
    return () => window.removeEventListener('storybook:router-refresh', refresh);
  }, []);
  return (
    <Foundation>
      <div style={{ maxWidth: 720, padding: 32 }}>
        <h1>Request reconciliation</h1>
        <InboxActionRequestPollingProvider
          enabled
          serverRequests={failedReceipt && durable ? [durable] : []}
        >
          <ConfirmedAction
            target={{
              guildId: 'guild-1',
              kind: 'observed_alert',
              recordId,
              targetUserId: 'member-1',
              label: 'Member one',
              loadedAt: `completed-read-${revision}`,
            }}
            action={{
              id: 'ban_user',
              label: 'Ban member',
              description: 'Ban Member one from this server. No message deletion requested.',
            }}
            durableRequest={durable}
            submit={async () => ({
              kind: 'request',
              receipt: { id: 'request-b', status: failedReceipt ? 'failed' : 'queued' },
            })}
          />
        </InboxActionRequestPollingProvider>
        <span data-testid="refresh-count">{refreshCount}</span>
        <span data-testid="selection">{recordId}</span>
        <button onClick={() => setRevision((value) => value + 1)}>Rerender same intent</button>
        <button
          onClick={() => {
            setRecordId('detection-2');
            setDurable(null);
          }}
        >
          Select next record
        </button>
        <button
          onClick={() =>
            setDurable({
              ...request,
              id: 'request-a',
              status: 'completed',
              updatedAt: '2026-10-25T12:00:03Z',
            })
          }
        >
          Update other request
        </button>
        <button
          onClick={() =>
            setDurable({
              ...request,
              id: 'request-b',
              status: 'processing',
              updatedAt: '2026-10-25T12:00:04Z',
            })
          }
        >
          Supply returned request
        </button>
      </div>
    </Foundation>
  );
}
export const FailedReceiptIdentity: Story = { render: () => <RequestLifecycle failedReceipt /> };
export const PersistentProvider: Story = { render: () => <RequestLifecycle /> };
