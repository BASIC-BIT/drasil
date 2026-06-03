import {
  buildAdminActionCustomId,
  parseAdminActionCustomId,
} from '../../utils/adminActionCustomIds';

describe('adminActionCustomIds (unit)', () => {
  it('keeps observed confirmation IDs under Discord custom_id limits', () => {
    const userId = '1234567890123456789';
    const detectionEventId = '12345678-1234-1234-1234-123456789012';

    const customId = buildAdminActionCustomId(
      'confirm_observed_false_positive',
      'observed',
      userId,
      detectionEventId
    );

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAdminActionCustomId(customId)).toEqual({
      action: 'confirm_observed_false_positive',
      surface: 'observed',
      userId,
      detectionEventId,
    });
  });
});
