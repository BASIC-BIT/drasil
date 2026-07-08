import { getReportIntakeSettings } from '../../utils/reportIntakeSettings';

describe('reportIntakeSettings (unit)', () => {
  it('falls back for old restrict confirmed response mode values', () => {
    expect(
      getReportIntakeSettings({ report_intake_confirmed_response_mode: 'restrict' } as any)
        .confirmedResponseMode
    ).toBe('observed_alert');
  });
});
