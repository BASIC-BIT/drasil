import { setupCommandSchema, settingsSectionSchemas, buildSetupSettingsPatch } from '../index';

test.each(Object.keys(settingsSectionSchemas))(
  'section %s is closed and cannot smuggle policy fields',
  (section) => {
    expect(
      setupCommandSchema.safeParse({
        kind: 'update_settings',
        section,
        changes: { actor: 'owner', arbitrary_setting: true },
      }).success
    ).toBe(false);
    expect(
      setupCommandSchema.safeParse({ kind: 'update_settings', section, changes: {} }).success
    ).toBe(true);
  }
);
test.each([
  'actor',
  'source',
  'permissions',
  'previousPermissionSyncState',
  'candidatePermissionSyncState',
  'updatedBy',
  'guildId',
])('public commands reject %s', (field) => {
  expect(
    setupCommandSchema.safeParse({ kind: 'update_setup', changes: {}, [field]: 'forged' }).success
  ).toBe(false);
  expect(
    setupCommandSchema.safeParse({ kind: 'update_setup', changes: { [field]: 'forged' } }).success
  ).toBe(false);
});
test('repost requires deliberate expected panel and fresh submission bindings', () => {
  for (const missing of ['submissionId', 'expectedMessageId', 'expectedChannelId']) {
    const command: Record<string, unknown> = {
      kind: 'upsert_report_instructions',
      channelId: 'channel',
      repost: true,
      submissionId: 'submission',
      expectedMessageId: null,
      expectedChannelId: null,
    };
    delete command[missing];
    expect(setupCommandSchema.safeParse(command).success).toBe(false);
  }
});
test('canonical setup mapping normalizes IDs and preserves false, zero, null and arrays', () => {
  expect(
    buildSetupSettingsPatch({
      guildId: 'guild',
      moderationQueueChannelId: '  queue  ',
      reportInstructionsChannelId: ' ',
      reportAiMaxImages: 0,
      analyticsConsentLevel: 'off',
      roleGateEnabled: false,
      verificationPromptTemplate: null,
      expectedTopics: [],
    })
  ).toEqual({
    moderation_queue_channel_id: 'queue',
    report_instructions_channel_id: null,
    report_ai_max_images: 0,
    analytics_consent_level: 'off',
    role_gate_enabled: false,
    verification_prompt_template: null,
    expected_topics: [],
  });
});
