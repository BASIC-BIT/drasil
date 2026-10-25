import {
  createDelegatedDirectExecutor,
  ActionDeniedError,
  setupCommandSchema,
  type AttentionActions,
  type DirectActionExecutor,
  type ReportReviewActions,
} from '@drasil/application';
import { createBotSetupRuntime, type BotSetupDependencies } from './setup';
import { createApprovedSetupConfiguration } from './approvedSetup';
import { createBotAuthority } from './authority';
export function createBotDirectActionExecutor(
  deps: BotSetupDependencies & { attention: AttentionActions; reportReview: ReportReviewActions }
): DirectActionExecutor {
  return createDelegatedDirectExecutor(deps, {
    async execute(context, command, preconditions) {
      const runtime = createBotSetupRuntime(
        deps,
        createBotAuthority(deps.client),
        createApprovedSetupConfiguration(deps.configService, preconditions)
      );
      const result = await runtime.actions.execute(context, setupCommandSchema.parse(command));
      if (result.kind === 'denied') throw new ActionDeniedError(result.code);
      return result.outcome;
    },
  });
}
