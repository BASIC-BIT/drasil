import { z } from 'zod';
import { reportHandoffSchema } from '../reports/analysis';
import { authorizeAttention, type AuthorityPort } from '../authorization';
import type { ActionContext } from '../context';
import type { ActionResult } from '../results';

export const queueAttentionItemTypes = [
  'support_thread_attention',
  'quarantine_breach_attention',
  'report_thread_attention',
] as const;
export type QueueAttentionItemType = (typeof queueAttentionItemTypes)[number];
export type QueueAttentionAcknowledgeStatus = 'acknowledged' | 'already_handled';
export interface QueueActionActor {
  readonly id: string;
  readonly surface: string;
}
export interface QueueAttentionItemRecord {
  readonly id: string;
  readonly server_id: string;
  readonly item_type: string;
  readonly queue_channel_id: string | null;
  readonly queue_message_id: string | null;
  readonly report_intake_id?: string | null;
  readonly metadata?: unknown;
}
export interface QueueAttentionRepository {
  findById(id: string): Promise<QueueAttentionItemRecord | null>;
  acknowledgeIdentityReview(input: {
    itemId: string;
    guildId: string;
    actorId: string;
    acknowledgedAt: Date;
  }): Promise<QueueAttentionAcknowledgeStatus>;
  deleteById(id: string): Promise<QueueAttentionItemRecord | null>;
}
export interface QueueMessageDeleter {
  deleteQueueMessage(item: QueueAttentionItemRecord): Promise<void>;
}
export interface AttentionOutcome {
  readonly actor: QueueActionActor;
  readonly itemId: string;
  readonly status: QueueAttentionAcknowledgeStatus;
}
export interface AttentionDependencies {
  readonly repository: QueueAttentionRepository;
  readonly messageDeleter: QueueMessageDeleter;
  readonly authority: AuthorityPort;
}
const acknowledgeSchema = z.object({ itemId: z.string().min(1) }).strict();
const batchSchema = z.object({ itemIds: z.array(z.string().min(1)) }).strict();
export interface AttentionActions {
  acknowledge(
    context: ActionContext,
    input: z.infer<typeof acknowledgeSchema>
  ): Promise<ActionResult<AttentionOutcome>>;
  acknowledgeBatch(
    context: ActionContext,
    input: { readonly itemIds: readonly string[] }
  ): Promise<readonly ActionResult<AttentionOutcome>[]>;
}
export function isQueueAttentionItemType(itemType: string): itemType is QueueAttentionItemType {
  return queueAttentionItemTypes.some((type) => type === itemType);
}
export function createAttentionActions(deps: AttentionDependencies): AttentionActions {
  async function acknowledge(
    context: ActionContext,
    input: { readonly itemId: string }
  ): Promise<ActionResult<AttentionOutcome>> {
    const { itemId } = acknowledgeSchema.parse(input);
    const denial = await authorizeAttention(context, deps.authority);
    if (denial) return { kind: 'denied', code: denial };
    // Authorization rejects system actors; retain the narrowed user identity for audit output.
    if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
    const actor = { id: context.actor.userId, surface: context.source };
    const item = await deps.repository.findById(itemId);
    if (!item || item.server_id !== context.guildId || !isQueueAttentionItemType(item.item_type)) {
      return { kind: 'outcome', outcome: { actor, itemId, status: 'already_handled' } };
    }
    if (isIdentityReviewItem(item)) {
      const status = await deps.repository.acknowledgeIdentityReview({
        itemId,
        guildId: context.guildId,
        actorId: actor.id,
        acknowledgedAt: new Date(),
      });
      return { kind: 'outcome', outcome: { actor, itemId, status } };
    }
    await deps.messageDeleter.deleteQueueMessage(item);
    const deleted = await deps.repository.deleteById(item.id);
    return {
      kind: 'outcome',
      outcome: { actor, itemId, status: deleted ? 'acknowledged' : 'already_handled' },
    };
  }
  return {
    acknowledge,
    async acknowledgeBatch(context, input): Promise<readonly ActionResult<AttentionOutcome>[]> {
      const { itemIds } = batchSchema.parse(input);
      const results: ActionResult<AttentionOutcome>[] = [];
      for (const itemId of itemIds) results.push(await acknowledge(context, { itemId }));
      return results;
    },
  };
}

export function isIdentityReviewItem(item: QueueAttentionItemRecord): boolean {
  const metadata = z
    .object({ identity_review: z.record(z.string(), z.unknown()) })
    .safeParse(item.metadata);
  return (
    item.item_type === 'report_thread_attention' &&
    Boolean(item.report_intake_id) &&
    metadata.success
  );
}

/** Preserve the independently validated handoff even when other analysis metadata is quarantined. */
export function acknowledgeIdentityReviewMetadata(
  metadata: unknown,
  actorId: string,
  at: Date
): Record<string, unknown> | null {
  const parsed = z
    .object({ analysis: z.object({ handoff: reportHandoffSchema }).passthrough() })
    .passthrough()
    .safeParse(metadata);
  if (!parsed.success) return null;
  const { analysis } = parsed.data;
  if (analysis.handoff.state !== 'pending' && analysis.handoff.state !== 'delivered') return null;
  return {
    ...parsed.data,
    analysis: {
      ...analysis,
      handoff: {
        ...analysis.handoff,
        state: 'acknowledged',
        acknowledgedBy: actorId,
        acknowledgedAt: at.toISOString(),
      },
    },
  };
}
