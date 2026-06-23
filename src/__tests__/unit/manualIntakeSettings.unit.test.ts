import {
  getManualIntakeSettings,
  MAX_MANUAL_INTAKE_GRACE_PERIOD_SECONDS,
} from '../../utils/manualIntakeSettings';

describe('manualIntakeSettings (unit)', () => {
  it('defaults to disabled with a 30 second grace period', () => {
    expect(getManualIntakeSettings()).toEqual({
      enabled: false,
      roleId: null,
      gracePeriodSeconds: 30,
    });
  });

  it('normalizes configured role and clamps the grace period', () => {
    expect(
      getManualIntakeSettings({
        manual_intake_enabled: true,
        manual_intake_role_id: 'manual-role',
        manual_intake_grace_period_seconds: 999,
      })
    ).toEqual({
      enabled: true,
      roleId: 'manual-role',
      gracePeriodSeconds: MAX_MANUAL_INTAKE_GRACE_PERIOD_SECONDS,
    });
  });
});
