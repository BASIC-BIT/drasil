import type { WorkspaceMutationResult } from './workspaceActionTypes';
import type {
  ModerationActionRequestQueueStatus,
  ModerationActionRequestReceipt,
} from './moderationActionRequestQueue';

export type InboxActionStatus = 'idle' | ModerationActionRequestQueueStatus;

export interface InboxActionState {
  readonly message: string | null;
  readonly requestId: string | null;
  readonly status: InboxActionStatus;
}

export const initialInboxActionState: InboxActionState = {
  message: null,
  requestId: null,
  status: 'idle',
};

export function isInboxActionSubmitBlocked(status: InboxActionStatus): boolean {
  return status === 'queued' || status === 'processing' || status === 'completed';
}

export function isInboxActionInFlight(status: InboxActionStatus): boolean {
  return status === 'queued' || status === 'processing';
}

export function shouldUseDurableInboxActionState(
  localState: InboxActionState,
  durableRequest: {
    readonly id: string;
    readonly status: InboxActionStatus;
    readonly updatedAt: string;
  },
  durableUpdatedAtAtSubmit: string | null
): boolean {
  if (localState.status === 'idle') {
    return true;
  }
  if (durableRequest.id !== localState.requestId) {
    return false;
  }
  const staleFailedReceipt =
    isInboxActionInFlight(localState.status) &&
    isStaleInboxActionFailure(durableRequest, durableUpdatedAtAtSubmit);
  return !staleFailedReceipt;
}

export function completedInboxActionState(
  message: string,
  requestId: string | null = null
): InboxActionState {
  return {
    message,
    requestId,
    status: 'completed',
  };
}

export function queuedInboxActionState(
  receipt: ModerationActionRequestReceipt,
  message = 'Action queued for Drasil.'
): InboxActionState {
  return {
    message,
    requestId: receipt.id,
    status: receipt.status,
  };
}

export function failedInboxActionState(error: unknown): InboxActionState {
  if (
    error &&
    typeof error === 'object' &&
    'digest' in error &&
    typeof error.digest === 'string' &&
    error.digest.startsWith('NEXT_REDIRECT')
  ) {
    throw error;
  }

  return {
    message:
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'The action could not be completed.',
    requestId: null,
    status: 'failed',
  };
}

export function workspaceRequestReceipt(
  result: WorkspaceMutationResult | null
): ModerationActionRequestReceipt | null {
  if (result?.kind === 'request') return result.receipt;
  if (
    result?.kind === 'report_open' &&
    result.result.status === 'queued' &&
    result.result.requestId
  )
    return { id: result.result.requestId, status: 'queued' };
  return null;
}
export function shouldUseDurableWorkspaceActionResult(
  localResult: WorkspaceMutationResult | null,
  durableRequest: {
    readonly id: string;
    readonly status: InboxActionStatus;
    readonly updatedAt: string;
  },
  durableUpdatedAtAtSubmit: string | null
): boolean {
  const receipt = workspaceRequestReceipt(localResult);
  const state = receipt
    ? queuedInboxActionState(receipt)
    : localResult
      ? failedInboxActionState('')
      : initialInboxActionState;
  return shouldUseDurableInboxActionState(state, durableRequest, durableUpdatedAtAtSubmit);
}

export function isStaleInboxActionFailure(
  request: { readonly status: InboxActionStatus; readonly updatedAt: string },
  baseline: string | null
): boolean {
  return (
    request.status === 'failed' &&
    baseline !== null &&
    (request.updatedAt === baseline || Date.parse(request.updatedAt) < Date.parse(baseline))
  );
}
