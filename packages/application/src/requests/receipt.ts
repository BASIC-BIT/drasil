import type { CaseCommand } from '../cases/commands';
export interface QueuedActionReceipt {
  readonly id: string;
  readonly status: 'queued' | 'processing' | 'completed' | 'failed';
}
// The codec alone owns the optional-column database representation.
export interface EnqueueInput {
  readonly actionType: CaseCommand['kind'];
  readonly actorId: string;
  readonly actorSurface: string;
  readonly serverId: string;
  readonly targetUserId: string;
  readonly detectionEventId?: string | null;
  readonly reportIntakeId?: string | null;
  readonly verificationEventId?: string | null;
  readonly idempotencyKey: string;
  readonly metadata: Record<string, unknown>;
}
