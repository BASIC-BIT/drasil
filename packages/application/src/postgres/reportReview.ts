import { z } from 'zod';
import { ActionDeniedError } from '../results';
import type { ReportReviewReferenceStore, PortableReportReview } from '../reports/reviewReference';
import type { DelegationDatabase } from './delegation';
const privateSchema = z
  .object({
    operationId: z.string(),
    targetUserId: z.string(),
    attemptToken: z.string(),
    updatedAt: z.string().datetime(),
    observedBanId: z.string().optional(),
    expiresAt: z.string().datetime(),
    consumedBy: z.string().uuid().nullable(),
  })
  .strict();
const uuid = z.string().uuid();
interface Row extends Record<string, unknown> {
  id: string;
  private: unknown;
}
function portable(id: string, value: z.infer<typeof privateSchema>): PortableReportReview {
  return {
    operationId: value.operationId,
    targetUserId: value.targetUserId,
    reviewReference: id,
    expiresAt: new Date(value.expiresAt),
  };
}
/** This namespace is deliberately outside queue results and immutable encoded provenance. */
export function createReportReviewReferenceStore(
  database: DelegationDatabase
): ReportReviewReferenceStore {
  return {
    async save(executionId, reference): ReturnType<ReportReviewReferenceStore['save']> {
      const payload = { ...reference, updatedAt: reference.updatedAt.toISOString() };
      const result = await database.query<Row>(
        `update moderation_action_requests q set metadata=jsonb_set(coalesce(q.metadata,'{}'::jsonb),'{mcp_report_review_private}', $2::jsonb || jsonb_build_object('expiresAt', to_char((clock_timestamp()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'consumedBy',null)) from mcp_executions e where e.id=$1::uuid and e.queue_request_id=q.id and e.started_at is not null and e.completed_at is null and e.resolved->>'workflowId'='prepare_report_ban_review' and e.resolved->'command'->>'operationId'=$3 and q.actor_surface='mcp' and q.metadata->'delegation'->>'executionId'=e.id::text and not(q.metadata ? 'mcp_report_review_private') returning e.id,q.metadata->'mcp_report_review_private' as private`,
        [executionId, JSON.stringify(payload), reference.operationId]
      );
      const row = result.rows[0];
      if (!row) throw new ActionDeniedError('stale_state');
      return portable(row.id, privateSchema.parse(row.private));
    },
    async load(principal, guildId, reference): ReturnType<ReportReviewReferenceStore['load']> {
      if (!uuid.safeParse(reference).success) return null;
      const result = await database.query<Row>(
        `select e.id,q.metadata->'mcp_report_review_private' as private from mcp_executions e join moderation_action_requests q on q.id=e.queue_request_id where e.id=$1::uuid and e.user_id=$2 and e.client_id=$3 and e.connection_id=$4::uuid and e.grant_version=$5 and e.resolved->>'guildId'=$6 and e.resolved->>'workflowId'='prepare_report_ban_review' and e.completed_at is not null and q.status='completed'`,
        [
          reference,
          principal.userId,
          principal.clientId,
          principal.connectionId,
          principal.grantVersion,
          guildId,
        ]
      );
      const parsed = privateSchema.safeParse(result.rows[0]?.private);
      if (
        !parsed.success ||
        parsed.data.consumedBy ||
        Date.parse(parsed.data.expiresAt) <= Date.now()
      )
        return null;
      return portable(reference, parsed.data);
    },
    async claim(reviewExecutionId, reference): ReturnType<ReportReviewReferenceStore['claim']> {
      if (!uuid.safeParse(reference).success) return null;
      return database.transaction(async (client) => {
        const result = await client.query<Row>(
          `select p.id,q.metadata->'mcp_report_review_private' as private from mcp_executions r join mcp_executions p on p.id=$2::uuid join moderation_action_requests q on q.id=p.queue_request_id where r.id=$1::uuid and r.started_at is not null and r.completed_at is null and r.resolved->>'workflowId'='review_uncertain_report_ban' and r.resolved->'command'->>'reviewReference'=p.id::text and r.user_id=p.user_id and r.client_id=p.client_id and r.connection_id=p.connection_id and r.grant_version=p.grant_version and r.resolved->>'guildId'=p.resolved->>'guildId' and p.resolved->>'workflowId'='prepare_report_ban_review' and p.completed_at is not null and q.status='completed' for update of q`,
          [reviewExecutionId, reference]
        );
        const parsed = privateSchema.safeParse(result.rows[0]?.private);
        if (!parsed.success || parsed.data.consumedBy) return null;
        // Consume before expiry or domain binding validation, preserving native one-use semantics.
        await client.query(
          `update moderation_action_requests set metadata=jsonb_set(metadata,'{mcp_report_review_private,consumedBy}',to_jsonb($2::text)) where id=(select queue_request_id from mcp_executions where id=$1::uuid)`,
          [reference, reviewExecutionId]
        );
        if (Date.parse(parsed.data.expiresAt) <= Date.now()) return null;
        const payload = parsed.data;
        return {
          operationId: payload.operationId,
          targetUserId: payload.targetUserId,
          attemptToken: payload.attemptToken,
          updatedAt: new Date(payload.updatedAt),
          ...(payload.observedBanId ? { observedBanId: payload.observedBanId } : {}),
        };
      });
    },
  };
}
