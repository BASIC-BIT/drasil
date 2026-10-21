import { workflowDefinitions, ActionDeniedError, type IntentResolver } from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { createMcpHandler, createMcpToolCatalog } from './server';
import { createMcpActionDelivery } from './delivery';
import { createWebMcpReadTools } from './tools/reads';
import { createWebCaseIntentResolver } from './adapters/cases';
import { createWebReportResolution } from './adapters/reports';
import { createWebSetupIntentResolver } from './adapters/setup';
import { createWebContainmentResolution } from './adapters/containment';
import { createWebDelegationDatabase } from './adapters/database';
import { verifyMcpBearer } from './auth/principal';
import { getMcpConfig } from './config';
let handler: ((request: Request) => Promise<Response>) | undefined;
export async function handleMcpRequest(request: Request): Promise<Response> {
  const config = getMcpConfig();
  if (!config) return new Response(null, { status: 404 });
  if (!handler) {
    const cases = createWebCaseIntentResolver();
    const reports = createWebReportResolution(config.cursorSecret).resolver;
    const setup = createWebSetupIntentResolver();
    const containment = createWebContainmentResolution().resolver;
    const resolver: IntentResolver = {
      resolve(principal, invocation, context) {
        const family = workflowDefinitions.find((w) => w.id === invocation.workflowId)?.family;
        const selected =
          family === 'cases'
            ? cases
            : ['reports', 'detections', 'reportReview'].includes(family ?? '')
              ? reports
              : ['setup', 'operations'].includes(family ?? '')
                ? setup
                : ['cleanup', 'quarantine', 'captcha', 'attention'].includes(family ?? '')
                  ? containment
                  : null;
        if (!selected) throw new ActionDeniedError('unsupported_workflow');
        return selected.resolve(principal, invocation, context);
      },
    };
    const service = createMcpActionDelivery(resolver);
    const store = createDelegationStore(createWebDelegationDatabase());
    handler = createMcpHandler({
      config,
      service,
      tools: createMcpToolCatalog({ service, reads: createWebMcpReadTools(config.cursorSecret) }),
      loadIntent: store.loadIntent,
      verifyBearer: verifyMcpBearer,
    });
  }
  return handler(request);
}
