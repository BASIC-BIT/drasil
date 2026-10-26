// Test-build-only queue boundary for subsequent-slice member commands.
import type { submitQueuedAction as ProductionSubmission } from '../../../lib/application/queuedSubmission';
export * from '../../../lib/application/queuedSubmission';
export const submitQueuedAction: typeof ProductionSubmission = async ({ command }) => ({
  id: `legacy-test-${command.kind}`,
  status: 'queued',
});
