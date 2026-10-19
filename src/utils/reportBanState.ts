import { z } from 'zod';
import { Prisma } from '../db/prisma';
import { CaseKind, CaseAttentionState, CaseContainmentStatus } from '../repositories/types';

export const reportBanPhases = [
  'preparing',
  'enforcement_started',
  'discord_confirmed',
  'reconciliation_required',
] as const;
export type ReportBanPhase = (typeof reportBanPhases)[number];
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid report-ban timestamp');
const caseSnapshot = z.object({
  id: z.string(),
  case_kind: z.nativeEnum(CaseKind).nullish(),
  attention_state: z.nativeEnum(CaseAttentionState).nullish(),
  containment_status: z.nativeEnum(CaseContainmentStatus).nullish(),
  parked_at: timestamp.nullish(),
  parked_by: z.string().nullish(),
});
const reportBanStateSchema = z.object({
  report_ban_phase: z.enum(reportBanPhases).nullish(),
  report_ban_attempt_token: z.string().nullish(),
  report_ban_preparation_id: z.string().nullish(),
  report_ban_enforcement_id: z.string().nullish(),
  report_ban_attempt_id: z.string().nullish(),
  report_ban_cases: z.array(caseSnapshot).nullish(),
  report_ban_case_ids: z.array(z.string()).nullish(),
  report_ban_reason: z.string().nullish(),
  report_ban_source_detail: z.string().nullish(),
  report_ban_membership_joined_at: timestamp.nullish(),
  report_ban_target_snapshot: z.record(z.string()).nullish(),
  report_ban_confirmed_at: timestamp.nullish(),
  report_ban_retry_count: z.number().int().nonnegative().nullish(),
  report_ban_retry_at: timestamp.nullish(),
  report_ban_lease_until: timestamp.nullish(),
  report_ban_last_error: z.string().nullish(),
  report_ban_closeout_message_id: z.string().nullish(),
  report_ban_analytics_claimed_at: timestamp.nullish(),
  report_ban_observed_ban: z
    .object({
      id: z.string(),
      attempt_token: z.string().nullish(),
      occurred_at: timestamp.nullish(),
      source: z.string().nullish(),
      source_detail: z.string().nullish(),
      actor_id: z.string().nullish(),
      audit_log_entry_id: z.string().nullish(),
      membership_joined_at: timestamp.nullish(),
      case_id: z.string().nullish(),
      case_revision: z.number().nullish(),
      uncertain_result: z.unknown(),
    })
    .nullish(),
});

export type ReportBanState = z.infer<typeof reportBanStateSchema>;
export type ReportBanPatch = Omit<ReportBanState, 'report_ban_observed_ban'>;
export type ReportBanCaseSnapshot = z.infer<typeof caseSnapshot>;

// Old operations can be partial. Malformed recognized fields must fail closed,
// never turn a persisted ownership/confirmation fence into an absent field.
export function parseReportBanState(metadata: unknown): ReportBanState {
  return reportBanStateSchema.parse(metadata ?? {});
}

export type ReportBanTransition =
  | {
      kind: 'prepare';
      report_ban_preparation_id: string;
      report_ban_reason: string;
      report_ban_source_detail: string | null;
      report_ban_membership_joined_at: null;
      report_ban_lease_until: string;
    }
  | { kind: 'record_membership'; report_ban_membership_joined_at: string | null }
  | { kind: 'record_target'; report_ban_target_snapshot: Record<string, string> }
  | {
      kind: 'prepare_cases';
      report_ban_cases: ReportBanCaseSnapshot[];
      report_ban_attempt_id: string;
    }
  | { kind: 'start_enforcement'; report_ban_enforcement_id: string; report_ban_case_ids: string[] }
  | { kind: 'confirm_discord'; report_ban_confirmed_at: string }
  | {
      kind: 'schedule_reconciliation';
      report_ban_phase: 'discord_confirmed' | 'reconciliation_required';
      report_ban_retry_count: number;
      report_ban_confirmed_at?: string;
      report_ban_retry_at: string;
      report_ban_lease_until: string;
      report_ban_last_error: string;
    }
  | { kind: 'renew_lease'; report_ban_lease_until: string; report_ban_retry_at?: string }
  | { kind: 'record_closeout'; report_ban_closeout_message_id: string }
  | { kind: 'finish' };

export function reportBanTransitionPatch(transition: ReportBanTransition): ReportBanPatch {
  const { kind, ...fields } = transition;
  switch (kind) {
    case 'prepare':
      return { ...fields, report_ban_phase: 'preparing' };
    case 'start_enforcement':
      return { ...fields, report_ban_phase: 'enforcement_started' };
    case 'confirm_discord':
      return { ...fields, report_ban_phase: 'discord_confirmed' };
    case 'finish':
      return {
        report_ban_phase: null,
        report_ban_lease_until: null,
        report_ban_retry_at: null,
        report_ban_last_error: null,
      };
    case 'record_membership':
    case 'record_target':
    case 'prepare_cases':
    case 'schedule_reconciliation':
    case 'renew_lease':
    case 'record_closeout':
      return fields;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function canAdvanceReportBanPhase(
  metadata: ReportBanState,
  status: string,
  result: unknown,
  patch: ReportBanState
): boolean {
  const receipt = z
    .object({ observed_ban_result: z.object({ status: z.string().optional() }).nullish() })
    .parse(result ?? {});
  const phase = metadata.report_ban_phase;
  const next = patch.report_ban_phase;
  if (receipt.observed_ban_result?.status === 'banned' && next !== null) return false;
  if (status === 'failed' && !phase) return false;
  if (phase === 'discord_confirmed' && next && next !== 'discord_confirmed') return false;
  if (phase && next === 'preparing') return false;
  return next !== 'enforcement_started' || phase === 'preparing';
}

export function ownedReportBanPatch(
  metadata: ReportBanState,
  patch: ReportBanPatch
): ReportBanPatch {
  const owned = { ...patch };
  delete owned.report_ban_attempt_token;
  if (metadata.report_ban_confirmed_at) delete owned.report_ban_confirmed_at;
  if (metadata.report_ban_phase && metadata.report_ban_phase !== 'preparing') {
    delete owned.report_ban_cases;
    delete owned.report_ban_case_ids;
    delete owned.report_ban_attempt_id;
    delete owned.report_ban_preparation_id;
    delete owned.report_ban_enforcement_id;
    delete owned.report_ban_membership_joined_at;
  }
  return owned;
}

export function assertUnrelatedReportBanMetadata(metadata: Prisma.JsonObject): void {
  if (Object.keys(metadata).some((key) => key in reportBanStateSchema.shape))
    throw new Error('Use transitionReportBan for report-ban state writes.');
}
