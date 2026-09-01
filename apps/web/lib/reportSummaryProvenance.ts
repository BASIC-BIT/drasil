import type { ReportSummarySource } from '@drasil/contracts';

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveReportSummarySource(
  summary: string | null,
  metadata: unknown
): ReportSummarySource {
  if (!summary) {
    return 'other';
  }

  const root = toRecord(metadata);
  if (root.summary_source === 'ai_report_intake_extraction') {
    return 'ai';
  }

  const agent = toRecord(root.report_intake_agent);
  const extraction = toRecord(agent.extraction);
  const abuseSignals = Array.isArray(extraction.abuseSignals)
    ? extraction.abuseSignals.filter((value): value is string => typeof value === 'string')
    : [];

  return abuseSignals.length > 0 && abuseSignals.join('; ') === summary ? 'ai' : 'other';
}
