import { getReportIntakeSettings } from '../../utils/reportIntakeSettings';

describe('reportIntakeSettings (unit)', () => {
  it('falls back for old restrict confirmed response mode values', () => {
    expect(
      getReportIntakeSettings({ report_intake_confirmed_response_mode: 'restrict' } as any)
        .confirmedResponseMode
    ).toBe('observed_alert');
  });
});

it('keeps the staged processor off unless explicitly enabled', () => {
  expect(getReportIntakeSettings()).toMatchObject({ stagedEnabled: false });
  expect(getReportIntakeSettings({ report_intake_staged_enabled: true })).toMatchObject({
    stagedEnabled: true,
  });
});
