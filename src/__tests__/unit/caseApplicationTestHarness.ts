import { createCaseActions } from '@drasil/application';
import type { BotApplication } from '../../application/createBotApplication';
import {
  createBotCaseDependencies,
  createCaseConfirmationStore,
  type BotCaseDependencies,
} from '../../application/adapters/cases';

// Existing controller units arrange interaction permission gates independently.
// These runtime facts are explicit; execution-time revocation is covered with the
// actual Discord authority adapter in CaseActions.unit.test.ts.
export function buildCaseApplication(
  deps: Omit<BotCaseDependencies, 'confirmations'>
): BotApplication {
  const caseConfirmations = createCaseConfirmationStore();
  const ports = createBotCaseDependencies({
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  return {
    cases: createCaseActions({
      ...ports,
      authority: {
        async loadFresh(guildId, userId) {
          return { guildId, userId, present: true, owner: false, permissions: '8', roleIds: [] };
        },
      },
    }),
    caseConfirmations,
    caseRepository: deps.verificationEventRepository,
    attention: {
      async acknowledge() {
        throw new Error('Not arranged for case units');
      },
      async acknowledgeBatch() {
        throw new Error('Not arranged for case units');
      },
    },
  };
}
