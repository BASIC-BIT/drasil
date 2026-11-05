import {
  buildSetupSettingsPatch,
  guildSetupUpdateSchema,
  serverSettingsSchema,
  settingsSectionSchemas,
} from './settings';

test('validates the staged intake selector and accepts its report patch', () => {
  expect(serverSettingsSchema.safeParse({ report_intake_staged_enabled: 'true' }).success).toBe(
    false
  );
  expect(
    guildSetupUpdateSchema.safeParse({ guildId: 'guild', reportIntakeStagedEnabled: true }).success
  ).toBe(true);
  expect(
    settingsSectionSchemas.report.safeParse({ report_intake_staged_enabled: true }).success
  ).toBe(true);
});
test('preserves an explicit false patch and leaves omitted selector unchanged', () => {
  const update = guildSetupUpdateSchema.parse({
    guildId: 'guild',
    reportIntakeStagedEnabled: false,
  });
  expect(buildSetupSettingsPatch(update)).toEqual({ report_intake_staged_enabled: false });
  expect(buildSetupSettingsPatch({ guildId: 'guild' })).toEqual({});
});

test('does not reset the selector when a report patch omits it', () => {
  expect(settingsSectionSchemas.report.parse({ report_ai_analyze_text: false })).toEqual({
    report_ai_analyze_text: false,
  });
});
