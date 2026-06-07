import { describe, expect, it } from 'vitest';
import {
  formatCaseAction,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatSurfaceKind,
  formatUtc,
  presenceStatusClass,
} from './casePresentation';

describe('casePresentation', () => {
  it('formats explicit active-case labels', () => {
    expect(formatCaseAction('ban_by_id')).toBe('Ban by ID');
    expect(formatPresenceState('left_or_removed')).toBe('Left or removed');
    expect(presenceStatusClass('banned')).toBe('status error');
    expect(formatSurfaceKind('source_message')).toBe('Source message');
  });

  it('formats case metadata for display', () => {
    expect(formatDetectionType('gpt_analysis')).toBe('GPT Analysis');
    expect(formatDetectionType('report_ai_id')).toBe('Report AI ID');
    expect(formatConfidence(0.914)).toBe('91%');
    expect(formatConfidence(null)).toBe('No score');
    expect(formatUtc(null)).toBe('Unknown');
    expect(formatUtc('not-a-date')).toBe('Unknown');
  });
});
