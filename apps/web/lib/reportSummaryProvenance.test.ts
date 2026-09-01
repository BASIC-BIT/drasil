import { describe, expect, it } from 'vitest';
import { resolveReportSummarySource } from './reportSummaryProvenance';

describe('resolveReportSummarySource', () => {
  it('uses the explicit summary source for new AI-authored intake summaries', () => {
    expect(
      resolveReportSummarySource('Possible impersonation attempt', {
        summary_source: 'ai_report_intake_extraction',
      })
    ).toBe('ai');
  });

  it('recognizes AI-authored summaries stored before the explicit marker shipped', () => {
    expect(
      resolveReportSummarySource('Possible impersonation attempt; Suspicious link flow', {
        report_intake_agent: {
          extraction: {
            abuseSignals: ['Possible impersonation attempt', 'Suspicious link flow'],
          },
        },
      })
    ).toBe('ai');
  });

  it('does not label unrelated report summaries as AI-authored', () => {
    expect(resolveReportSummarySource('Reporter supplied context', {})).toBe('other');
  });
});
