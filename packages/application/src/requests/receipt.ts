import type { QueuedCommand } from './commands';
export type QueuedJson =
  | string
  | number
  | boolean
  | null
  | QueuedJson[]
  | { [key: string]: QueuedJson };
export interface QueuedActionReceipt {
  readonly id: string;
  readonly status: 'queued' | 'processing' | 'completed' | 'failed';
}
// The codec alone owns the optional-column database representation.
export interface EnqueueInput {
  readonly actionType: QueuedCommand['kind'];
  readonly actorId: string;
  readonly actorSurface: string;
  readonly serverId: string;
  readonly targetUserId: string;
  readonly messageDeletionJobId?: string;
  readonly detectionEventId?: string | null;
  readonly reportIntakeId?: string | null;
  readonly verificationEventId?: string | null;
  readonly idempotencyKey: string;
  readonly metadata: { [key: string]: QueuedJson };
}
