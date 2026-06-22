import { getReportIntakeSettings } from '../../utils/reportIntakeSettings';

describe('reportIntakeSettings (unit)', () => {
  it('maps legacy restrict confirmed response mode to open case', () => {
    expect(
      getReportIntakeSettings({ report_intake_confirmed_response_mode: 'restrict' } as any)
        .confirmedResponseMode
    ).toBe('open_case');
  });
});
