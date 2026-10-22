import { workflowDefinitions } from './commands';
import type { IntentResolver } from './types';
import { ActionDeniedError } from '../results';
/** Both runtimes use the same closed family routing and preserve revalidation context. */
export function createHumanIntentResolver(resolvers: {
  cases: IntentResolver;
  reports: IntentResolver;
  setup: IntentResolver;
  containment: IntentResolver;
}): IntentResolver {
  return {
    resolve(principal, invocation, context): ReturnType<IntentResolver['resolve']> {
      const family = workflowDefinitions.find((w) => w.id === invocation.workflowId)?.family;
      const selected =
        family === 'cases'
          ? resolvers.cases
          : ['reports', 'detections', 'reportReview'].includes(family ?? '')
            ? resolvers.reports
            : ['setup', 'operations'].includes(family ?? '')
              ? resolvers.setup
              : ['cleanup', 'quarantine', 'captcha', 'attention'].includes(family ?? '')
                ? resolvers.containment
                : null;
      if (!selected) throw new ActionDeniedError('unsupported_workflow');
      return selected.resolve(principal, invocation, context);
    },
  };
}
