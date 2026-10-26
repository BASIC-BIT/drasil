import {
  parseReportBanState,
  reportBanTransitionPatch,
  canAdvanceReportBanPhase,
  ownedReportBanPatch,
} from '../../utils/reportBanState';

describe('report-ban persisted state boundary', () => {
  it.each([null, {}, { report_ban_phase: 'preparing' }, { report_ban_cases: [{ id: 'case' }] }])(
    'reads shipped partial state %p',
    (metadata) => {
      expect(() => parseReportBanState(metadata)).not.toThrow();
    }
  );
  it.each([
    { report_ban_phase: 'unknown' },
    { report_ban_attempt_token: 42 },
    { report_ban_confirmed_at: false },
    { report_ban_confirmed_at: 'not a date' },
    { report_ban_case_ids: ['case', 42] },
    { report_ban_cases: [{ id: 42 }] },
    { report_ban_target_snapshot: { id: false } },
    { report_ban_retry_count: '1' },
  ])('rejects malformed recognized state without losing its fence: %p', (metadata) => {
    expect(() => parseReportBanState(metadata)).toThrow();
  });
  it('accepts both shipped timestamp encodings', () => {
    expect(
      parseReportBanState({
        report_ban_confirmed_at: '2026-10-19T12:00:00Z',
        report_ban_lease_until: '2026-10-19 12:00:00+00',
      })
    ).toBeDefined();
  });
  it('keeps confirmation monotonic and preparation fields owned', () => {
    const state = parseReportBanState({
      report_ban_phase: 'discord_confirmed',
      report_ban_confirmed_at: '2026-10-19T12:00:00Z',
    });
    expect(
      canAdvanceReportBanPhase(
        state,
        'processing',
        {},
        { report_ban_phase: 'reconciliation_required' }
      )
    ).toBe(false);
    expect(
      ownedReportBanPatch(state, {
        report_ban_case_ids: ['other'],
        report_ban_attempt_token: 'other',
        report_ban_confirmed_at: '2026-10-20T12:00:00Z',
        report_ban_closeout_message_id: 'message',
      })
    ).toEqual({ report_ban_closeout_message_id: 'message' });
  });
  it('allows terminal cleanup but never restarts a completed ban', () => {
    const state = parseReportBanState({ report_ban_phase: 'discord_confirmed' });
    const result = { observed_ban_result: { status: 'banned' } };
    expect(
      canAdvanceReportBanPhase(state, 'completed', result, { report_ban_phase: 'preparing' })
    ).toBe(false);
    expect(
      canAdvanceReportBanPhase(
        state,
        'completed',
        result,
        reportBanTransitionPatch({ kind: 'finish' })
      )
    ).toBe(true);
  });
  it('requires preparation before enforcement and rejects a failed phase-less owner', () => {
    expect(
      canAdvanceReportBanPhase({}, 'processing', {}, { report_ban_phase: 'enforcement_started' })
    ).toBe(false);
    expect(canAdvanceReportBanPhase({}, 'failed', {}, { report_ban_phase: 'preparing' })).toBe(
      false
    );
  });
});
