import {
  ActionDeniedError,
  createCaptchaActions,
  decodeQueuedAction,
  type AuthorityPort,
  type ActionResult,
  type CaptchaActions,
  type CaptchaDependencies,
  type CaptchaState,
  type DecodedQueuedAction,
  type ConfirmationPort,
} from '@drasil/application';
import type { Client } from 'discord.js';
import type { ICaptchaChallengeService } from '../../services/CaptchaChallengeService';
import type { IConfigService } from '../../config/ConfigService';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import type { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import type { IThreadManager } from '../../services/ThreadManager';
import type { INotificationManager } from '../../services/NotificationManager';
import type { IUserModerationService } from '../../services/UserModerationService';
import {
  CaptchaChallengeRequestSource,
  type ModerationActionRequest,
} from '../../repositories/types';
import { getCaptchaSettings } from '../../utils/captchaSettings';
import { createBotAuthority } from './authority';
import { CaptchaEffects } from './captchaEffects';

export interface BotCaptchaDependencies {
  readonly client: Client;
  readonly configService: IConfigService;
  readonly verificationEventRepository: IVerificationEventRepository;
  readonly actionRequests: IModerationActionRequestRepository;
  readonly captchaChallengeService: ICaptchaChallengeService | null;
  readonly threadManager: IThreadManager;
  readonly notificationManager: INotificationManager;
  readonly userModerationService: IUserModerationService;
  readonly confirmations: ConfirmationPort;
}
export interface BotCaptchaRuntime {
  readonly actions: CaptchaActions;
  forRequest(request: ModerationActionRequest): CaptchaActions;
  decodeRequest(request: ModerationActionRequest): Promise<DecodedQueuedAction>;
}
export function createBotCaptchaRuntime(
  deps: BotCaptchaDependencies,
  authority: AuthorityPort = createBotAuthority(deps.client)
): BotCaptchaRuntime {
  const service = (): ICaptchaChallengeService => {
    if (!deps.captchaChallengeService) throw new Error('Security-check service is unavailable.');
    return deps.captchaChallengeService;
  };
  const state: CaptchaDependencies['state'] = {
    async load(_context, command): Promise<CaptchaState | null> {
      const event = await deps.verificationEventRepository.findById(command.caseId);
      if (!event) return null;
      const challenge =
        command.kind === 'apply_captcha_pass'
          ? await service().findById(command.challengeId)
          : await service().findByCaseId(command.caseId);
      if (
        challenge &&
        (challenge.server_id !== event.server_id ||
          challenge.user_id !== event.user_id ||
          challenge.verification_event_id !== event.id)
      )
        return null;
      return {
        guildId: event.server_id,
        caseId: event.id,
        targetUserId: event.user_id,
        status: event.status,
        caseKind: event.case_kind ?? 'standard',
        challenge: challenge
          ? {
              id: challenge.id,
              generation: challenge.generation,
              caseRevision: challenge.case_revision_at_issue,
              status: challenge.status,
            }
          : null,
      };
    },
  };
  const actions = (request: ModerationActionRequest | null): CaptchaActions => {
    const effects = (): CaptchaEffects =>
      new CaptchaEffects(
        deps.actionRequests,
        deps.verificationEventRepository,
        deps.client,
        deps.threadManager,
        deps.notificationManager,
        deps.userModerationService,
        service()
      );
    return createCaptchaActions({
      authority,
      confirmations: deps.confirmations,
      state,
      settings: {
        async loadFresh(guildId) {
          return {
            enabled:
              getCaptchaSettings(
                (
                  await deps.configService.getServerConfig(guildId, {
                    forceRefresh: true,
                    failOnReadError: true,
                  })
                ).settings
              ).mode !== 'off',
          };
        },
      },
      workflows: {
        async recoverCommitted(context, command) {
          if (
            !request ||
            context.actor.kind !== 'user' ||
            request.id !== context.requestId ||
            request.actor_id !== context.actor.userId ||
            request.server_id !== context.guildId ||
            request.target_user_id !== command.targetUserId ||
            request.verification_event_id !== command.caseId
          )
            return null;
          const workflow = effects();
          return (await workflow.completeRecordedCaptchaMutation(
            request,
            command.kind === 'bypass_captcha_challenge'
              ? 'bypass'
              : command.kind === 'retry_captcha_challenge'
                ? 'retry'
                : 'request'
          ))
            ? workflow.takeOutcome()
            : null;
        },
        async request(context, command) {
          if (context.actor.kind !== 'user') throw new Error('CAPTCHA moderation requires a user.');
          await (
            await deps.client.guilds.fetch(context.guildId)
          ).members.fetch({ user: command.targetUserId, force: true });
          const result = await service().requestChallenge({
            ...(request ? { actionRequestId: request.id } : {}),
            verificationEventId: command.caseId,
            requestSource: CaptchaChallengeRequestSource.MODERATOR,
            requestedBy: context.actor.userId,
            retry: command.kind === 'retry_captcha_challenge',
            ...(command.kind === 'retry_captcha_challenge'
              ? {
                  expectedChallengeId: command.expectedChallengeId,
                  expectedGeneration: command.expectedGeneration,
                }
              : {}),
          });
          return {
            action_type: command.kind,
            challenge_id: result.challenge.id,
            generation: result.challenge.generation,
            delivered: result.delivered,
            target_user_id: command.targetUserId,
            verification_event_id: command.caseId,
          };
        },
        async bypass(context, command) {
          if (context.actor.kind !== 'user') throw new Error('CAPTCHA moderation requires a user.');
          const challenge = await service().bypassChallenge({
            ...(request ? { actionRequestId: request.id } : {}),
            verificationEventId: command.caseId,
            moderatorId: context.actor.userId,
            reason: command.reason.trim(),
            expectedChallengeId: command.expectedChallengeId,
            expectedGeneration: command.expectedGeneration,
          });
          return {
            action_type: command.kind,
            challenge_id: challenge.id,
            generation: challenge.generation,
            bypassed: true,
            target_user_id: command.targetUserId,
            verification_event_id: command.caseId,
          };
        },
        async applyPass(_context, command) {
          if (!request) throw new Error('CAPTCHA pass requires a durable request.');
          const workflow = effects();
          await workflow.applyCaptchaPass(request, command);
          return workflow.takeOutcome();
        },
        async notifyAttention(_context, command) {
          if (!request) throw new Error('CAPTCHA attention requires a durable request.');
          const workflow = effects();
          await workflow.notifyCaptchaAttention(request, command);
          return workflow.takeOutcome();
        },
      },
    });
  };
  return {
    actions: actions(null),
    forRequest: actions,
    async decodeRequest(request): Promise<DecodedQueuedAction> {
      const decoded = decodeQueuedAction(request);
      const command = decoded.command;
      if (command.kind !== 'apply_captcha_pass' && command.kind !== 'notify_captcha_attention')
        return decoded;
      if (request.actor_id !== 'drasil:captcha' || request.actor_surface !== 'captcha')
        throw new Error(
          command.kind === 'apply_captcha_pass'
            ? 'Security-check completion request is invalid.'
            : 'Security-check attention request is invalid.'
        );
      const current = await service().findById(command.challengeId);
      if (
        !current ||
        current.server_id !== request.server_id ||
        current.user_id !== command.targetUserId ||
        current.verification_event_id !== command.caseId ||
        current.id !== command.challengeId
      )
        throw new Error('Security-check system request binding is invalid.');
      return {
        command,
        context: {
          ...decoded.context,
          actor: {
            kind: 'system',
            purpose: command.kind === 'apply_captcha_pass' ? 'captcha_pass' : 'captcha_attention',
          },
        },
      };
    },
  };
}
export function requireCaptchaOutcome<T>(result: ActionResult<T>): T {
  if (result.kind === 'outcome') return result.outcome;
  const messages = {
    permission_denied: 'Security-check actions require current moderation permission.',
    actor_unavailable: 'Security-check actions require current moderation permission.',
    binding_mismatch: 'Security-check request does not match its case subject.',
    stale_state: 'The security check changed. Refresh the case and try again.',
    policy_disabled: 'Security checks are disabled for this server.',
    reason_required: 'A reason is required to continue without the browser check.',
    confirmation_required: 'Security-check confirmation is missing or expired.',
  };
  throw new ActionDeniedError(result.code, messages[result.code]);
}
