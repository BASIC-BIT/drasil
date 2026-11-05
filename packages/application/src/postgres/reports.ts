import type { DelegationQueryClient } from './delegation';
import type { ReportOpenCaseRepository, ReportOpenCaseCandidate } from '../reports/review';
import type { ReportIntakeState } from '../reports/ports';
import { projectReportIntakeState, type ReportIntakeSnapshot } from '../reports/intakeState';
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
        const result = await database.query<ReportIntakeSnapshot & Record<string, unknown>>(
          `select id,server_id,reporter_id,thread_id,status,confirmed_target_user_id,evidence_revision,metadata from report_intakes where id=$1::uuid`,
          [id]
        );
        return result.rows[0] ? projectReportIntakeState(result.rows[0]) : null;
      },
    },
  };
}
