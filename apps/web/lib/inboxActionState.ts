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
