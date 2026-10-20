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
  type MessageCleanupActions,
} from '@drasil/application';
import type { Client } from 'discord.js';
import type { IModerationQueueRepository } from '../repositories/ModerationQueueRepository';
import type { IModerationQueueService } from '../services/ModerationQueueService';
import { createBotAuthority, createBotAttentionMessageDeleter } from './adapters/attention';

export interface BotApplication {
  readonly operations: BotOperationsRuntime['actions'];
  readonly operationsRuntime: BotOperationsRuntime;
  readonly messageCleanup: MessageCleanupActions;
  readonly messageCleanupRuntime: BotMessageCleanupRuntime;
  readonly captcha: BotCaptchaRuntime['actions'];
  readonly captchaRuntime: BotCaptchaRuntime;
  readonly quarantine: BotQuarantineRuntime['actions'];
  readonly quarantineRuntime: BotQuarantineRuntime;
  readonly detections: BotDetectionRuntime['actions'];
  readonly detectionRuntime: BotDetectionRuntime;
  readonly attention: AttentionActions;
  readonly cases: CaseActions;
  readonly caseConfirmations: ReturnType<typeof createCaseConfirmationStore>;
  readonly caseRepository: BotCaseDependencies['verificationEventRepository'];
}
export function createBotApplication(
  deps: BotOperationsDependencies &
    Omit<BotCaseDependencies, 'confirmations'> &
    BotMessageCleanupDependencies &
    Pick<
      BotCaptchaDependencies,
      'captchaChallengeService' | 'threadManager' | 'notificationManager'
    > & {
      readonly client: Client;
      readonly accountQuarantineService: BotQuarantineDependencies['accountQuarantineService'];
      readonly actionRequests: BotDetectionDependencies['actionRequests'];
      readonly queueRepository: IModerationQueueRepository;
      readonly queueService: IModerationQueueService;
    }
): BotApplication {
  const caseConfirmations = createCaseConfirmationStore();
  const operationsRuntime = createBotOperationsRuntime({
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  const detectionRuntime = createBotDetectionRuntime({
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
    operations: operationsRuntime.actions,
    operationsRuntime,
    messageCleanupRuntime,
    messageCleanup: {
      async execute(): ReturnType<MessageCleanupActions['execute']> {
        throw new Error('Cleanup requires a persisted request runtime.');
      },
    },
    captcha: captchaRuntime.actions,
    captchaRuntime,
    quarantine: quarantineRuntime.actions,
    quarantineRuntime,
    detections: detectionRuntime.actions,
    detectionRuntime,
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
