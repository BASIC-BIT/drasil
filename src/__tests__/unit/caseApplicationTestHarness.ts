import { createBotDetectionRuntime } from '../../application/adapters/detections';
import { createCaseConfirmationStore } from '../../application/context';
import { createCaseActions, type AuthorityPort } from '@drasil/application';
import type { BotApplication } from '../../application/createBotApplication';
import {
  createBotCaseDependencies,
  type BotCaseDependencies,
} from '../../application/adapters/cases';

// Existing controller units arrange interaction permission gates independently.
// These runtime facts are explicit; execution-time revocation is covered with the
// actual Discord authority adapter in CaseActions.unit.test.ts.
export function buildCaseApplication(
  deps: Omit<BotCaseDependencies, 'confirmations'>,
  authority?: AuthorityPort
): BotApplication {
  const caseConfirmations = createCaseConfirmationStore();
  const ports = createBotCaseDependencies({
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  const detectionRuntime = createBotDetectionRuntime(
    {
      ...deps,
      actionRequests: {
        async findById(id: string) {
          return {
            id,
            action_type: 'ban_observed_detection',
            server_id: 'guild-1',
            target_user_id: 'target',
            detection_event_id: 'detection',
            report_intake_id: 'report',
            actor_id: 'moderator',
            actor_surface: 'web',
            metadata: { report_ban_phase: 'reconciliation_required' },
          };
        },
      } as never,
      confirmations: caseConfirmations.confirmations,
    },
    authority ?? {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions: '8', roleIds: [] };
      },
    }
  );
  return {
    detections: detectionRuntime.actions,
    detectionRuntime,
    cases: createCaseActions({
      ...ports,
      authority: authority ?? {
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
