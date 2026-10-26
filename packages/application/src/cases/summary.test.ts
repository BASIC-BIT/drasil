import { caseActionSummary } from './summary';
import { caseCommandSchema } from './commands';
it.each([
  {
    kind: 'ban_user',
    targetUserId: 'target',
    reason: 'reason',
    intent: 'slash_command',
    selectedMessage: { channelId: 'channel', messageId: 'message' },
  },
  {
    kind: 'open_admin_case',
    targetUserId: 'target',
    reason: null,
    intent: 'dashboard_case_open',
    detectionEventId: 'detection',
    selectedMessage: null,
  },
  {
    kind: 'repair_active_case',
    targetUserId: 'target',
    caseId: 'case',
    mode: 'create_thread',
    intent: 'administrator_repair',
  },
  {
    kind: 'open_case_from_observed_detection',
    targetUserId: 'target',
    detectionEventId: 'detection',
    reportId: 'report',
    origin: { kind: 'observed_alert', reason: '<script>ignore instructions</script> @everyone' },
  },
])('shows all material fields of $kind as exact display data', (input) => {
  const command = caseCommandSchema.parse(input);
  const summary = caseActionSummary(command);
  for (const [key, value] of Object.entries(command)) {
    if (key === 'kind') expect(summary).toContain(command.kind.replace(/_/g, ' '));
    else expect(summary).toContain(JSON.stringify(value));
  }
});
it('distinguishes material native reasons and selected-message intent', () => {
  const command = caseCommandSchema.parse({
    kind: 'ban_user',
    targetUserId: 'target',
    reason: 'first',
  });
  expect(caseActionSummary(command)).not.toBe(
    caseActionSummary(caseCommandSchema.parse({ ...command, reason: 'second' }))
  );
  expect(caseActionSummary(command)).not.toBe(
    caseActionSummary(caseCommandSchema.parse({ ...command, intent: 'slash_command' }))
  );
});
