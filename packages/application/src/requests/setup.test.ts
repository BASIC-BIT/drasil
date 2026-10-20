import { decodeQueuedAction } from './decode';
import { encodeQueuedAction } from './encode';
import type { ActionContext } from '../context';
const context: ActionContext = {
  guildId: 'guild',
  requestId: 'submission',
  source: 'web',
  actor: { kind: 'user', userId: 'admin' },
};
test('onboarding retains shipped key, null preservation and metadata', () => {
  const encoded = encodeQueuedAction(context, {
    kind: 'complete_setup_verification',
    mode: 'provision',
    adminChannelId: 'admin-channel',
    caseRoleId: null,
    onboardingWizard: true,
    submissionId: 'submission',
  });
  expect(encoded.idempotencyKey).toBe('web:setup:complete_setup_verification:guild:submission');
  expect(encoded.metadata).toEqual({
    admin_channel_id: 'admin-channel',
    case_role_id: null,
    detection_response_mode: null,
    report_instructions_channel_id: null,
    requested_surface: 'web',
    onboarding_wizard: true,
    setup_action: 'complete_setup_verification',
    submission_id: 'submission',
    verification_channel_id: null,
  });
  const decoded = decodeQueuedAction({
    id: 'job',
    server_id: 'guild',
    action_type: encoded.actionType,
    actor_id: 'admin',
    actor_surface: 'web',
    target_user_id: null,
    metadata: encoded.metadata,
  });
  expect(decoded.command).toMatchObject({
    kind: 'complete_setup_verification',
    mode: 'provision',
    onboardingWizard: true,
    submissionId: 'submission',
  });
});
test('legacy panel rows bind retries to the durable request and cannot supply authority or provenance', () => {
  const decoded = decodeQueuedAction({
    id: 'job',
    server_id: 'guild',
    action_type: 'upsert_report_instructions',
    actor_id: 'admin',
    actor_surface: 'web',
    target_user_id: null,
    metadata: {
      channel_id: 'channel',
      repost: true,
      expected_message_id: 'old',
      expected_channel_id: 'channel',
      actor: 'forged',
      previous_verification_channel_permission_sync: { forged: true },
    },
  });
  expect(decoded.command).toEqual({
    kind: 'upsert_report_instructions',
    channelId: 'channel',
    repost: true,
    expectedMessageId: 'old',
    expectedChannelId: 'channel',
    submissionId: 'job',
  });
  expect(
    encodeQueuedAction(context, {
      kind: 'upsert_report_instructions',
      channelId: 'channel',
      repost: true,
      expectedMessageId: 'old',
      expectedChannelId: 'channel',
      submissionId: 'submission',
    }).idempotencyKey
  ).toBe('web:setup:repost_report_instructions:guild:channel:old:submission');
});
