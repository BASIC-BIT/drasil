import { createHumanIntentResolver } from '@drasil/application';
import { createMcpActionDelivery } from './delivery';
import { createWebCaseIntentResolver } from './adapters/cases';
import { createWebReportResolution } from './adapters/reports';
import { createWebSetupIntentResolver } from './adapters/setup';
import { createWebContainmentResolution } from './adapters/containment';
import { getMcpConfig } from './config';
export function createWebMcpActionService() {
  const config = getMcpConfig();
  if (!config) throw new Error('Approvals unavailable.');
  return createMcpActionDelivery(
    createHumanIntentResolver({
      cases: createWebCaseIntentResolver(),
      reports: createWebReportResolution(config.cursorSecret).resolver,
      setup: createWebSetupIntentResolver(),
      containment: createWebContainmentResolution().resolver,
    })
  );
}
