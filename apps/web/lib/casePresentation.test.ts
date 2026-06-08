import { describe, expect, it } from 'vitest';
import {
  formatCaseAction,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatSurfaceKind,
  formatUtc,
  moderationOutcomeStatusClass,
  presenceStatusClass,
} from './casePresentation';

describe('casePresentation', () => {
  it('formats explicit active-case labels', () => {
    expect(formatCaseAction('ban_by_id')).toBe('Ban by ID');
    expect(formatPresenceState('left_or_removed')).toBe('Member Left Server');
    expect(presenceStatusClass('banned')).toBe('status error');
    expect(presenceStatusClass('in_server')).toBe('status info');
    expect(moderationOutcomeStatusClass('restricted')).toBe('status warning');
    expect(formatSurfaceKind('source_message')).toBe('Open Source Message');
  });

  it('formats case metadata for display', () => {
    expect(formatDetectionType('gpt_analysis')).toBe('GPT Analysis');
    expect(formatDetectionType('report_ai_id')).toBe('Report AI ID');
    expect(formatConfidence(0.914)).toBe('High Confidence');
    expect(formatConfidence(null)).toBe('No Signal');
    expect(formatUtc(null)).toBe('Unknown');
    expect(formatUtc('not-a-date')).toBe('Unknown');
  });
});
