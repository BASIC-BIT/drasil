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
} from '@drasil/application';
import type { Client } from 'discord.js';
import type { IModerationQueueRepository } from '../repositories/ModerationQueueRepository';
import type { IModerationQueueService } from '../services/ModerationQueueService';
import { createBotAuthority, createBotAttentionMessageDeleter } from './adapters/attention';

export interface BotApplication {
  readonly detections: BotDetectionRuntime['actions'];
  readonly detectionRuntime: BotDetectionRuntime;
  readonly attention: AttentionActions;
  readonly cases: CaseActions;
  readonly caseConfirmations: ReturnType<typeof createCaseConfirmationStore>;
  readonly caseRepository: BotCaseDependencies['verificationEventRepository'];
}
export function createBotApplication(
  deps: Omit<BotCaseDependencies, 'confirmations'> & {
    readonly client: Client;
    readonly actionRequests: BotDetectionDependencies['actionRequests'];
    readonly queueRepository: IModerationQueueRepository;
    readonly queueService: IModerationQueueService;
  }
): BotApplication {
  const caseConfirmations = createCaseConfirmationStore();
  const detectionRuntime = createBotDetectionRuntime({
    ...deps,
    confirmations: caseConfirmations.confirmations,
  });
  return {
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
