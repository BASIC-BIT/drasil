import { createDelegatedCaseActions } from './adapters/delegatedCases';
import type { DelegatedWorkerRuntime } from './adapters/delegation';
import {
  createBotSetupRuntime,
  type BotSetupRuntime,
  type BotSetupDependencies,
} from './adapters/setup';
import { createBotReportActions, type BotReportDependencies } from './adapters/reports';
import {
  createBotOperationsRuntime,
  type BotOperationsRuntime,
  type BotOperationsDependencies,
} from './adapters/operations';
import {
  createBotMessageCleanupRuntime,
  type BotMessageCleanupDependencies,
  type BotMessageCleanupRuntime,
} from './adapters/messageCleanup';
import {
  createBotCaptchaRuntime,
  type BotCaptchaRuntime,
  type BotCaptchaDependencies,
} from './adapters/captcha';
import {
  createBotQuarantineRuntime,
  type BotQuarantineRuntime,
  type BotQuarantineDependencies,
} from './adapters/quarantine';
import {
  createBotDetectionRuntime,
  type BotDetectionDependencies,
  type BotDetectionRuntime,
} from './adapters/detections';
import { createCaseConfirmationStore } from './context';
import { createBotCaseActions, type BotCaseDependencies } from './adapters/cases';
import {
  createAttentionActions,
  type AttentionActions,
  type CaseActions,
  type ExecutionRecord,
} from '@drasil/application';
import type { Client } from 'discord.js';
import type { IModerationQueueRepository } from '../repositories/ModerationQueueRepository';
import type { IModerationQueueService } from '../services/ModerationQueueService';
import { createBotAuthority } from './adapters/authority';
import { createBotAttentionMessageDeleter } from './adapters/attention';

export interface BotApplication {
  readonly delegation?: DelegatedWorkerRuntime;
  readonly setup: BotSetupRuntime['actions'];
  readonly setupRuntime: BotSetupRuntime;
  readonly reports: ReturnType<typeof createBotReportActions>;
  readonly operations: BotOperationsRuntime['actions'];
  readonly operationsRuntime: BotOperationsRuntime;
  readonly messageCleanupRuntime: BotMessageCleanupRuntime;
  readonly captcha: BotCaptchaRuntime['actions'];
  readonly captchaRuntime: BotCaptchaRuntime;
  readonly quarantine: BotQuarantineRuntime['actions'];
  readonly quarantineRuntime: BotQuarantineRuntime;
  readonly detections: BotDetectionRuntime['actions'];
  readonly detectionRuntime: BotDetectionRuntime;
  readonly attention: AttentionActions;
  readonly cases: CaseActions;
  readonly casesForExecution?: (execution: ExecutionRecord) => CaseActions;
  readonly caseConfirmations: ReturnType<typeof createCaseConfirmationStore>;
  readonly caseRepository: BotCaseDependencies['verificationEventRepository'];
}
export function createBotApplication(
  deps: BotSetupDependencies &
    BotOperationsDependencies &
    Pick<BotReportDependencies, 'reportIntakeService'> &
    Omit<BotCaseDependencies, 'confirmations'> &
    BotMessageCleanupDependencies &
    Pick<
      BotCaptchaDependencies,
      'captchaChallengeService' | 'threadManager' | 'notificationManager'
    > & {
      readonly client: Client;
      readonly delegation?: DelegatedWorkerRuntime;
      readonly accountQuarantineService: BotQuarantineDependencies['accountQuarantineService'];
      readonly actionRequests: BotDetectionDependencies['actionRequests'];
      readonly queueRepository: IModerationQueueRepository;
      readonly queueService: IModerationQueueService;
    }
): BotApplication {
  const setupRuntime = createBotSetupRuntime(deps);
  const caseConfirmations = createCaseConfirmationStore();
  const operationsRuntime = createBotOperationsRuntime({
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  const detectionRuntime = createBotDetectionRuntime({
    reviewReferences: deps.delegation?.reviews,
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  const captchaRuntime = createBotCaptchaRuntime({
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  const messageCleanupRuntime = createBotMessageCleanupRuntime(deps);
  const quarantineRuntime = createBotQuarantineRuntime(deps);
  return {
    delegation: deps.delegation,
    setup: setupRuntime.actions,
    setupRuntime,
    reports: createBotReportActions(deps),
    operations: operationsRuntime.actions,
    operationsRuntime,
    messageCleanupRuntime,
    captcha: captchaRuntime.actions,
    captchaRuntime,
    quarantine: quarantineRuntime.actions,
    quarantineRuntime,
    detections: detectionRuntime.actions,
    detectionRuntime,
    casesForExecution: (execution) =>
      createDelegatedCaseActions(
        { ...deps, confirmations: caseConfirmations.confirmations },
        execution,
        deps.delegation?.native
      ),
    cases: createBotCaseActions({ ...deps, confirmations: caseConfirmations.confirmations }),
    caseConfirmations,
    caseRepository: deps.verificationEventRepository,
    attention: createAttentionActions({
      repository: deps.queueRepository,
      authority: createBotAuthority(deps.client),
      messageDeleter: createBotAttentionMessageDeleter(deps.queueService),
    }),
  };
}
