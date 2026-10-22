import type { DelegationQueryClient } from './delegation';
import type { ReportOpenCaseRepository, ReportOpenCaseCandidate } from '../reports/review';
import type { ReportIntakeState } from '../reports/ports';
export function createReportResources(database: DelegationQueryClient): {
  openCaseRepository: ReportOpenCaseRepository;
  intakes: { load(id: string): Promise<ReportIntakeState | null> };
} {
  return {
    openCaseRepository: {
      async findSubmittedReportCaseCandidate(input): Promise<ReportOpenCaseCandidate | null> {
        const result = await database.query<ReportOpenCaseCandidate & Record<string, unknown>>(
          `select ri.id,ri.server_id,ri.status,ri.confirmed_target_user_id,coalesce(ri.metadata->>'report_ban_operation_id','')<>'' as busy,de.id as latest_detection_id,de.latest_verification_event_id as latest_case_id from report_intakes ri left join lateral (select id,latest_verification_event_id from detection_events where server_id=ri.server_id and metadata->>'reportIntakeId'=ri.id::text order by detected_at desc nulls last,id desc limit 1) de on true where ri.id=$1::uuid and ri.server_id=$2 and ri.status='submitted' limit 1`,
          [input.reportId, input.serverId]
        );
        return result.rows[0] ?? null;
      },
    },
    intakes: {
      async load(id): Promise<ReportIntakeState | null> {
        const result = await database.query<ReportIntakeState & Record<string, unknown>>(
          `select id,server_id as "guildId",reporter_id as "reporterId",thread_id as "threadId",status,confirmed_target_user_id as "confirmedTargetUserId",metadata->>'last_confirmation_prompt_message_id' as "promptMessageId",metadata->>'last_confirmation_prompt_token' as "promptToken",coalesce(metadata->'last_confirmation_prompt_candidate_ids','[]'::jsonb) as "candidateIds",coalesce(metadata->>'report_ban_operation_id','')<>'' as claimed from report_intakes where id=$1::uuid`,
          [id]
        );
        const row = result.rows[0];
        return row
          ? {
              ...row,
              candidateIds: Array.isArray(row.candidateIds)
                ? row.candidateIds.filter((id): id is string => typeof id === 'string')
                : [],
            }
          : null;
      },
    },
  };
}
