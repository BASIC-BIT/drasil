export interface QueuedActionReceipt {
  readonly id: string;
  readonly status: 'queued' | 'processing' | 'completed' | 'failed';
}
export interface EnqueueInput {
  readonly actionType: 'open_case_from_observed_detection';
  readonly actorId: string;
  readonly actorSurface: string;
  readonly serverId: string;
  readonly targetUserId: string;
  readonly detectionEventId: string;
  readonly reportIntakeId: string | null;
  readonly idempotencyKey: string;
  readonly metadata: {
    readonly requested_surface: string;
    readonly report_intake_id: string | null;
  };
}
