import { z } from 'zod';
import {
  type ModerationInboxItem,
  type ReportAttentionRecord,
  reportAttentionRecordSchema,
} from '@drasil/contracts';
import { getPostgresPool } from './setupDataAdapter';
import { parseModerationQueueRow, type ModerationQueueRow } from './moderationInboxDataAdapter';
import { parseReportAttentionRows } from './reportDetailDataAdapter';
import { discordMessageUrl } from './discordUrls';
import type { ReplyReadState, SupportAttentionSubtype } from './moderationWorkspaceTypes';

export const attentionQueueTypeSchema = z.enum([
  'report_thread_attention',
  'support_thread_attention',
  'quarantine_breach_attention',
  'pending_screening_member',
]);
export type AttentionQueueType = z.infer<typeof attentionQueueTypeSchema>;
export interface AttentionDetail {
  readonly queueType: AttentionQueueType;
  readonly item: ModerationInboxItem;
  readonly subtype: SupportAttentionSubtype | null;
  readonly caseId: string | null;
  readonly reportId: string | null;
  readonly detectionId: string | null;
  readonly sourceThreadId: string | null;
  readonly latestReplyMessageId: string | null;
  readonly intake: ReportAttentionRecord | null;
  readonly reply: ReplyReadState;
}
export interface ModerationAttentionDataAdapter {
  getAttentionDetail(input: {
    guildId: string;
    queueItemId: string;
  }): Promise<AttentionDetail | null>;
}
export function createModerationAttentionDataAdapter(): ModerationAttentionDataAdapter {
  return {
    async getAttentionDetail({ guildId, queueItemId }): Promise<AttentionDetail | null> {
      const result = await getPostgresPool().query<ModerationQueueRow>(
        `select mqi.*, s.settings as server_settings, ve.case_kind, ve.status as case_status,
          de.detection_type, de.confidence as detection_confidence, de.detected_at as detection_detected_at,
          de.reasons as detection_reasons, de.metadata as detection_metadata,
          ri.status as report_status, ri.summary as report_summary, ri.metadata as report_metadata,
          u.username as user_username, u.metadata as user_metadata,
          sm.discord_member_pending_since, sm.discord_member_pending_last_checked_at
         from moderation_queue_items mqi
         left join verification_events ve on ve.id = mqi.verification_event_id and ve.server_id = mqi.server_id and ve.user_id = mqi.user_id
         left join detection_events de on de.id = mqi.detection_event_id and de.server_id = mqi.server_id and de.user_id = mqi.user_id
         left join report_intakes ri on ri.id = mqi.report_intake_id and ri.server_id = mqi.server_id
         left join server_members sm on sm.server_id = mqi.server_id and sm.user_id = mqi.user_id
         left join users u on u.discord_id = mqi.user_id
         left join servers s on s.guild_id = mqi.server_id
         where mqi.server_id = $1 and mqi.id::text = $2
         limit 1`,
        [guildId, queueItemId]
      );
      const row = result.rows[0];
      if (!row || row.server_id !== guildId) return null;
      const item = parseModerationQueueRow(row);
      if (
        !item ||
        !['report_attention', 'support_attention', 'pending_screening'].includes(item.kind)
      )
        return null;
      let intake: ReportAttentionRecord | null = null;
      if (item.kind === 'report_attention' && row.report_intake_id) {
        const report = await getPostgresPool().query<
          Parameters<typeof parseReportAttentionRows>[0]
        >(
          `select ri.*, target.username as target_display_name, reporter.username as reporter_display_name, de.id as latest_detection_id, linked_case.id as latest_case_id
           from report_intakes ri
           left join users target on target.discord_id = ri.confirmed_target_user_id
           left join users reporter on reporter.discord_id = ri.reporter_id
           left join lateral (select id, latest_verification_event_id from detection_events
             where server_id = ri.server_id and user_id = ri.confirmed_target_user_id and metadata->>'reportIntakeId' = ri.id::text
             order by detected_at desc nulls last limit 1) de on true
           left join verification_events linked_case on linked_case.id = de.latest_verification_event_id and linked_case.server_id = ri.server_id and linked_case.user_id = ri.confirmed_target_user_id
           where ri.server_id = $1 and ri.id::text = $2 limit 1`,
          [guildId, row.report_intake_id]
        );
        const record = report.rows[0];
        if (!record || record.server_id !== guildId || record.id !== row.report_intake_id)
          return null;
        const evidence = await getPostgresPool().query<
          Parameters<typeof parseReportAttentionRows>[1][number]
        >(
          `select e.* from report_intake_evidence e join report_intakes ri on ri.id = e.intake_id
           where ri.server_id = $1 and ri.id::text = $2 order by e.created_at asc`,
          [guildId, row.report_intake_id]
        );
        intake = reportAttentionRecordSchema.parse(parseReportAttentionRows(record, evidence.rows));
      }
      return {
        queueType: attentionQueueTypeSchema.parse(row.item_type),
        item,
        subtype: item.sourceMetadata?.subtype ?? null,
        caseId: row.verification_event_id,
        reportId: row.report_intake_id,
        detectionId: row.detection_event_id,
        sourceThreadId: row.source_thread_id,
        latestReplyMessageId: row.last_source_message_id,
        intake,
        // Live message reads wait for the actor channel-access guard. The posting channel is the reply destination, including breaches.
        reply: {
          kind: 'unavailable',
          sourceUrl: row.source_thread_id
            ? discordMessageUrl(guildId, row.source_thread_id, row.last_source_message_id)
            : null,
        },
      };
    },
  };
}
