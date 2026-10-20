import { createBotSetupRuntime, type BotSetupDependencies } from '../../application/adapters/setup';
import { buildReportActions } from './reportApplicationTestHarness';
import { mock } from 'jest-mock-extended';
import {
  createBotOperationsRuntime,
  type BotOperationsDependencies,
} from '../../application/adapters/operations';
import {
  createBotCaptchaRuntime,
  type BotCaptchaDependencies,
} from '../../application/adapters/captcha';
import {
  createBotQuarantineRuntime,
  type BotQuarantineDependencies,
} from '../../application/adapters/quarantine';
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
  deps: Omit<BotCaseDependencies, 'confirmations'> & {
    readonly setupDiagnosticsService?: BotSetupDependencies['setupDiagnosticsService'];
    readonly productAnalyticsService?: BotSetupDependencies['productAnalyticsService'];
    readonly queueService?: BotOperationsDependencies['queueService'];
    readonly integrityAuditService?: BotOperationsDependencies['integrityAuditService'];
    readonly caseRoleLockdownService?: BotOperationsDependencies['caseRoleLockdownService'];
    readonly caseThreadClosureSweepService?: BotOperationsDependencies['caseThreadClosureSweepService'];
    readonly captchaChallengeService?: BotCaptchaDependencies['captchaChallengeService'];
    readonly threadManager?: BotCaptchaDependencies['threadManager'];
    readonly notificationManager?: BotCaptchaDependencies['notificationManager'];
    readonly accountQuarantineService?: BotQuarantineDependencies['accountQuarantineService'];
  },
  authority?: AuthorityPort
): BotApplication {
  const setupRuntime = createBotSetupRuntime(
    {
      ...deps,
      notificationManager:
        deps.notificationManager ?? mock<BotSetupDependencies['notificationManager']>(),
      setupDiagnosticsService:
        deps.setupDiagnosticsService ?? mock<BotSetupDependencies['setupDiagnosticsService']>(),
      productAnalyticsService:
        deps.productAnalyticsService ?? mock<BotSetupDependencies['productAnalyticsService']>(),
      actionRequests: mock<BotSetupDependencies['actionRequests']>(),
    },
    authority ?? {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions: '8', roleIds: [] };
      },
    }
  );
  const caseConfirmations = createCaseConfirmationStore();
  const operationsRuntime = createBotOperationsRuntime(
    {
      ...deps,
      queueService: deps.queueService ?? mock<BotOperationsDependencies['queueService']>(),
      integrityAuditService:
        deps.integrityAuditService ?? mock<BotOperationsDependencies['integrityAuditService']>(),
      caseRoleLockdownService:
        deps.caseRoleLockdownService ??
        mock<BotOperationsDependencies['caseRoleLockdownService']>(),
      caseThreadClosureSweepService:
        deps.caseThreadClosureSweepService ??
        mock<BotOperationsDependencies['caseThreadClosureSweepService']>(),
      confirmations: caseConfirmations.confirmations,
    },
    authority ?? {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions: '8', roleIds: [] };
      },
    }
  );
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
  const quarantineRuntime = createBotQuarantineRuntime(
    {
      ...deps,
      accountQuarantineService: deps.accountQuarantineService ?? null,
      actionRequests: {
        async findById() {
          return null;
        },
      } as never,
    },
    authority ?? {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions: '8', roleIds: [] };
      },
    }
  );
  const captchaRuntime = createBotCaptchaRuntime(
    {
      ...deps,
      captchaChallengeService: deps.captchaChallengeService ?? null,
      threadManager: deps.threadManager ?? ({} as never),
      notificationManager: deps.notificationManager ?? ({} as never),
      actionRequests: {} as never,
      confirmations: caseConfirmations.confirmations,
    },
    authority ?? {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions: '8', roleIds: [] };
      },
    }
  );
  return {
    setup: setupRuntime.actions,
    setupRuntime,
    reports: buildReportActions({
      ...deps,
      reportIntakeService: {} as never,
      threadManager: deps.threadManager ?? ({} as never),
    }),
    operations: operationsRuntime.actions,
    operationsRuntime,
    messageCleanupRuntime: {
      forRequest() {
        throw new Error('Not arranged for these units');
      },
      async decodeRequest() {
        throw new Error('Not arranged for these units');
      },
      async afterComplete() {},
    },
    captcha: captchaRuntime.actions,
    captchaRuntime,
    quarantine: quarantineRuntime.actions,
    quarantineRuntime,
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
