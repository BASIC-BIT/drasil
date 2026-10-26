import type { Client, GuildMember } from 'discord.js';
import {
  captchaOutcomeSchema,
  type CaptchaOutcome,
  type CaptchaCommand,
} from '@drasil/application';
import type { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import type { ICaptchaChallengeService } from '../../services/CaptchaChallengeService';
import type { IUserModerationService } from '../../services/UserModerationService';
import type { IThreadManager } from '../../services/ThreadManager';
import type {
  CaptchaAttentionReason,
  INotificationManager,
} from '../../services/NotificationManager';
import {
  CaptchaChallenge,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseContainmentStatus,
  CaseKind,
  ModerationActionRequest,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { CAPTCHA_PRESENTATION_ATTEMPT_PREFIX } from '../../utils/caseRoleRelease';
import { DISCORD_UNKNOWN_MEMBER_ERROR_CODE, isDiscordErrorCode } from '../../utils/discordErrors';

// Persisted presentation receipts and leases remain local to the worker runtime.
export class CaptchaEffects {
  private outcome: CaptchaOutcome | null = null;
  public constructor(
    private readonly repository: IModerationActionRequestRepository,
    private readonly verificationEventRepository: IVerificationEventRepository,
    private readonly client: Client,
    private readonly threadManager: IThreadManager,
    private readonly notificationManager: INotificationManager,
    private readonly userModerationService: IUserModerationService,
    private readonly captchaChallengeService: ICaptchaChallengeService
  ) {}
  public takeOutcome(): CaptchaOutcome {
    if (!this.outcome) throw new Error('CAPTCHA workflow did not produce a receipt.');
    return this.outcome;
  }
  private async complete(outcome: unknown): Promise<void> {
    this.outcome = captchaOutcomeSchema.parse(outcome);
  }
  private async fetchGuildMember(serverId: string, userId: string): Promise<GuildMember> {
    return (await this.client.guilds.fetch(serverId)).members.fetch({ user: userId, force: true });
  }
  public async completeRecordedCaptchaMutation(
    request: ModerationActionRequest,
    operation: 'request' | 'retry' | 'bypass'
  ): Promise<boolean> {
    const receipt = this.readMetadataRecord(request.metadata, 'captcha_mutation_receipt');
    if (!receipt) {
      return false;
    }
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Security-check mutation receipt is invalid.');
    }
    const challengeId = typeof receipt.challenge_id === 'string' ? receipt.challenge_id : null;
    const generation =
      typeof receipt.generation === 'number' &&
      Number.isInteger(receipt.generation) &&
      receipt.generation >= 1
        ? receipt.generation
        : null;
    if (receipt.operation !== operation || !challengeId || generation === null) {
      throw new Error('Security-check mutation receipt is invalid.');
    }
    const challenge = await this.captchaChallengeService.findByCaseId(
      request.verification_event_id
    );
    if (
      !challenge ||
      challenge.id !== challengeId ||
      challenge.verification_event_id !== request.verification_event_id ||
      challenge.server_id !== request.server_id ||
      challenge.user_id !== request.target_user_id
    ) {
      throw new Error('The recorded security-check mutation no longer matches its case.');
    }
    if (
      !matchesRecordedCaptchaMutation({
        challenge,
        operation,
        generation,
        actorId: request.actor_id,
        reason: this.readMetadataString(request.metadata, 'reason'),
      })
    ) {
      throw new Error('The recorded security-check mutation could not be verified.');
    }
    const currentGeneration = challenge.generation === generation;
    await this.complete({
      action_type: request.action_type,
      challenge_id: challengeId,
      generation,
      resumed: true,
      ...(operation === 'bypass'
        ? { bypassed: true }
        : { delivered: currentGeneration && challenge.delivered_at !== null }),
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
    return true;
  }

  public async applyCaptchaPass(
    request: ModerationActionRequest,
    command: Extract<CaptchaCommand, { kind: 'apply_captcha_pass' }>
  ): Promise<void> {
    const { challengeId, generation, expectedCaseRevision } = command;
    const decision = await this.captchaChallengeService.evaluatePassedChallenge({
      challengeId,
      verificationEventId: command.caseId,
      targetUserId: command.targetUserId,
      generation,
      expectedCaseRevision,
    });
    let verificationEvent = await this.verificationEventRepository.findById(command.caseId);
    const challenge = await this.captchaChallengeService.findById(challengeId);
    if (!verificationEvent || !challenge) {
      throw new Error('Security-check completion presentation is unavailable.');
    }
    verificationEvent = await this.requireCaptchaPassPresentation(
      request,
      verificationEvent,
      challenge
    );
    const captchaResolution = this.readMetadataRecord(
      verificationEvent.metadata,
      'captcha_resolution'
    );
    const resumesCommittedResolution =
      decision.status === 'held' &&
      verificationEvent.status === VerificationStatus.VERIFIED &&
      verificationEvent.resolved_by === 'drasil:captcha' &&
      verificationEvent.server_id === request.server_id &&
      verificationEvent.user_id === command.targetUserId &&
      verificationEvent.case_revision === expectedCaseRevision &&
      captchaResolution?.challenge_id === challengeId &&
      captchaResolution.generation === generation;
    if (decision.status !== 'eligible' && !resumesCommittedResolution) {
      if (verificationEvent.status === VerificationStatus.PENDING) {
        const attentionReason =
          decision.status === 'held' ? 'automatic_resolution_held' : 'evidence_only_pass';
        await this.requireCaptchaAttention(
          request,
          verificationEvent,
          attentionReason,
          `captcha-attention:${challengeId}:${generation}:${attentionReason}`
        );
      }
      await this.complete({
        action_type: request.action_type,
        challenge_id: challengeId,
        effect: decision.status,
        generation,
        held_reason: decision.status === 'held' ? decision.reason : null,
        resolved: false,
        target_user_id: command.targetUserId,
        verification_event_id: command.caseId,
      });
      return;
    }

    let member: GuildMember | null;
    try {
      member = await this.fetchGuildMember(request.server_id, command.targetUserId);
    } catch (error) {
      if (!isDiscordErrorCode(error, DISCORD_UNKNOWN_MEMBER_ERROR_CODE)) {
        throw error;
      }
      member = null;
    }
    if (!member) {
      if (resumesCommittedResolution) {
        throw new Error(
          `CAPTCHA case ${verificationEvent.id} was resolved, but the member is unavailable for finalization.`
        );
      }
      if (verificationEvent.status === VerificationStatus.PENDING) {
        await this.requireCaptchaAttention(
          request,
          verificationEvent,
          'automatic_resolution_held',
          `captcha-attention:${challengeId}:${generation}:automatic_resolution_held`
        );
      }
      await this.complete({
        action_type: request.action_type,
        challenge_id: challengeId,
        effect: 'held',
        generation,
        held_reason: 'member_unavailable',
        resolved: false,
        target_user_id: command.targetUserId,
        verification_event_id: command.caseId,
      });
      return;
    }

    const result = await this.userModerationService.resolveCaptchaCase(member, {
      verificationEventId: command.caseId,
      challengeId,
      generation,
      expectedCaseRevision,
    });
    if (result.status === 'held' && verificationEvent.status === VerificationStatus.PENDING) {
      await this.requireCaptchaAttention(
        request,
        verificationEvent,
        'automatic_resolution_held',
        `captcha-attention:${challengeId}:${generation}:automatic_resolution_held`
      );
    }
    await this.complete({
      action_type: request.action_type,
      challenge_id: challengeId,
      effect: result.status,
      generation,
      held_reason: result.status === 'held' ? result.reason : null,
      resolved: result.status === 'resolved',
      target_user_id: command.targetUserId,
      verification_event_id: command.caseId,
    });
  }

  private async requireCaptchaPassPresentation(
    request: ModerationActionRequest,
    verificationEvent: VerificationEvent,
    challenge: CaptchaChallenge
  ): Promise<VerificationEvent> {
    if (verificationEvent.status !== VerificationStatus.PENDING) {
      await this.updateCaptchaPresentation(verificationEvent, challenge);
      return verificationEvent;
    }

    const attemptId = `${CAPTCHA_PRESENTATION_ATTEMPT_PREFIX}${challenge.id}:${challenge.generation}:passed`;
    const claimed = await this.verificationEventRepository.claimCaptchaPresentation({
      id: verificationEvent.id,
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      challengeId: challenge.id,
      generation: challenge.generation,
      expectedStatus: CaptchaChallengeStatus.PASSED,
      attemptId,
    });
    if (!claimed) {
      const current = await this.verificationEventRepository.findById(verificationEvent.id);
      if (!current) {
        throw new Error(`CAPTCHA case ${verificationEvent.id} is unavailable.`);
      }
      if (
        current.status !== VerificationStatus.PENDING ||
        current.case_kind !== CaseKind.STANDARD
      ) {
        await this.updateCaptchaPresentation(current, challenge);
        return current;
      }
      throw new Error(
        `CAPTCHA case ${verificationEvent.id} changed before completion could be presented.`
      );
    }

    let presentationError: unknown = null;
    try {
      await this.updateCaptchaPresentation(claimed, challenge);
      await this.requireCaptchaThreadStatus(
        request,
        claimed,
        'CAPTCHA passed.',
        attemptId,
        `Failed to deliver CAPTCHA completion for case ${claimed.id}.`
      );
    } catch (error) {
      presentationError = error;
    }

    const released = await this.verificationEventRepository.updateQuarantineAttempt(
      claimed.id,
      attemptId,
      {
        case_kind: CaseKind.STANDARD,
        attention_state: claimed.attention_state,
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
        parked_at: null,
        parked_by: null,
      }
    );
    if (!released) {
      throw new Error(`Failed to release CAPTCHA presentation claim for case ${claimed.id}.`);
    }
    if (presentationError) {
      throw presentationError;
    }
    return released;
  }

  private async updateCaptchaPresentation(
    verificationEvent: VerificationEvent,
    challenge: CaptchaChallenge,
    description = 'passed'
  ): Promise<void> {
    const presentationUpdated = this.notificationManager.updateCaptchaChallengePresentation
      ? await this.notificationManager.updateCaptchaChallengePresentation(
          verificationEvent,
          challenge
        )
      : false;
    if (!presentationUpdated) {
      throw new Error(
        `Failed to refresh ${description} CAPTCHA presentation for case ${verificationEvent.id}.`
      );
    }
  }

  private async requireCaptchaThreadStatus(
    request: ModerationActionRequest,
    verificationEvent: VerificationEvent,
    message: string,
    receipt: string,
    failureMessage: string
  ): Promise<void> {
    if (this.readMetadataString(request.metadata, 'captcha_thread_status_receipt') === receipt) {
      return;
    }
    const statusSent = await this.threadManager.sendCaptchaStatus(verificationEvent, message);
    if (!statusSent) {
      throw new Error(failureMessage);
    }
    const persisted = await this.repository.mergeMetadata(request.id, {
      captcha_thread_status_receipt: receipt,
    });
    if (!persisted) {
      throw new Error(`Failed to persist CAPTCHA status receipt for case ${verificationEvent.id}.`);
    }
  }

  private async requireCaptchaAttention(
    request: ModerationActionRequest,
    verificationEvent: VerificationEvent,
    reason: CaptchaAttentionReason,
    receipt: string
  ): Promise<void> {
    if (this.readMetadataString(request.metadata, 'captcha_attention_receipt') === receipt) {
      return;
    }
    const notified = this.notificationManager.notifyCaptchaAttention
      ? await this.notificationManager.notifyCaptchaAttention(verificationEvent, reason)
      : false;
    if (!notified) {
      throw new Error(`Failed to notify moderators about CAPTCHA case ${verificationEvent.id}.`);
    }
    const persisted = await this.repository.mergeMetadata(request.id, {
      captcha_attention_receipt: receipt,
    });
    if (!persisted) {
      throw new Error(
        `Failed to persist CAPTCHA attention receipt for case ${verificationEvent.id}.`
      );
    }
  }

  private captchaChallengeMatchesAttentionReason(
    challenge: CaptchaChallenge | null,
    reason: Extract<CaptchaCommand, { kind: 'notify_captcha_attention' }>['reason']
  ): challenge is CaptchaChallenge {
    if (!challenge) return false;
    switch (reason) {
      case 'member_assistance':
        return (
          challenge.status === CaptchaChallengeStatus.PENDING &&
          challenge.provider === 'discord_image'
        );
      case 'delivery_failed':
        return (
          challenge.status === CaptchaChallengeStatus.PENDING &&
          challenge.delivered_at === null &&
          Boolean(challenge.delivery_error_code)
        );
      case 'cancelled':
        return challenge.status === CaptchaChallengeStatus.CANCELLED;
      case 'bypassed':
        return challenge.status === CaptchaChallengeStatus.BYPASSED;
      case 'expired':
        return challenge.status === CaptchaChallengeStatus.EXPIRED;
      case 'submission_limit':
        return challenge.status === CaptchaChallengeStatus.FAILED;
      default: {
        const exhaustive: never = reason;
        return exhaustive;
      }
    }
  }

  private async requireCaptchaStatusPresentation(
    request: ModerationActionRequest,
    verificationEvent: VerificationEvent,
    challenge: CaptchaChallenge,
    reason: Extract<CaptchaCommand, { kind: 'notify_captcha_attention' }>['reason']
  ): Promise<boolean> {
    const canPresentAfterResolution = reason === 'cancelled' || reason === 'bypassed';
    if (verificationEvent.status !== VerificationStatus.PENDING) {
      if (canPresentAfterResolution) {
        await this.updateCaptchaPresentation(verificationEvent, challenge, reason);
      }
      return canPresentAfterResolution;
    }

    const attemptId = `${CAPTCHA_PRESENTATION_ATTEMPT_PREFIX}${challenge.id}:${challenge.generation}:${reason}`;
    const claimed = await this.verificationEventRepository.claimCaptchaPresentation({
      id: verificationEvent.id,
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      challengeId: challenge.id,
      generation: challenge.generation,
      expectedStatus: challenge.status,
      requireDeliveryError: reason === 'delivery_failed',
      attemptId,
    });
    if (!claimed) {
      const [current, currentChallenge] = await Promise.all([
        this.verificationEventRepository.findById(verificationEvent.id),
        this.captchaChallengeService.findByCaseId(verificationEvent.id),
      ]);
      if (!current) {
        throw new Error(`CAPTCHA case ${verificationEvent.id} is unavailable.`);
      }
      const challengeStillMatches =
        currentChallenge?.id === challenge.id &&
        currentChallenge.generation === challenge.generation &&
        this.captchaChallengeMatchesAttentionReason(currentChallenge, reason);
      if (current.status !== VerificationStatus.PENDING) {
        if (canPresentAfterResolution && challengeStillMatches) {
          await this.updateCaptchaPresentation(current, currentChallenge, reason);
          return true;
        }
        return false;
      }
      if (!challengeStillMatches) {
        return false;
      }
      throw new Error(
        `CAPTCHA case ${verificationEvent.id} changed before ${reason} could be presented.`
      );
    }

    let presentationError: unknown = null;
    try {
      await this.updateCaptchaPresentation(claimed, challenge, reason);
      if (reason === 'cancelled') {
        await this.requireCaptchaThreadStatus(
          request,
          claimed,
          'This CAPTCHA is no longer active.',
          attemptId,
          `Failed to deliver cancelled CAPTCHA status for case ${claimed.id}.`
        );
      } else if (reason === 'member_assistance') {
        await this.requireCaptchaAttention(request, claimed, reason, `${attemptId}:attention`);
      } else if (reason !== 'bypassed') {
        await this.requireCaptchaThreadStatus(
          request,
          claimed,
          reason === 'delivery_failed'
            ? 'CAPTCHA delivery failed. Ask a moderator to retry.'
            : reason === 'expired'
              ? 'CAPTCHA expired. Ask a moderator for a new one.'
              : 'Too many incorrect attempts. Ask a moderator for a new CAPTCHA.',
          attemptId,
          `Failed to deliver CAPTCHA status for case ${claimed.id}.`
        );
        await this.requireCaptchaAttention(request, claimed, reason, `${attemptId}:attention`);
      }
    } catch (error) {
      presentationError = error;
    }

    const released = await this.verificationEventRepository.updateQuarantineAttempt(
      claimed.id,
      attemptId,
      {
        case_kind: CaseKind.STANDARD,
        attention_state: claimed.attention_state,
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
        parked_at: null,
        parked_by: null,
      }
    );
    if (!released) {
      throw new Error(`Failed to release CAPTCHA presentation claim for case ${claimed.id}.`);
    }
    if (presentationError) {
      throw presentationError;
    }
    return true;
  }

  public async notifyCaptchaAttention(
    request: ModerationActionRequest,
    command: Extract<CaptchaCommand, { kind: 'notify_captcha_attention' }>
  ): Promise<void> {
    const { challengeId, generation, reason } = command;
    const [verificationEvent, challenge] = await Promise.all([
      this.verificationEventRepository.findById(command.caseId),
      this.captchaChallengeService.findByCaseId(command.caseId),
    ]);
    if (
      !verificationEvent ||
      verificationEvent.server_id !== request.server_id ||
      verificationEvent.user_id !== command.targetUserId
    ) {
      throw new Error('Security-check attention case binding is invalid.');
    }
    const challengeStateMatches = this.captchaChallengeMatchesAttentionReason(challenge, reason);
    if (
      (reason !== 'cancelled' &&
        reason !== 'bypassed' &&
        verificationEvent.status !== VerificationStatus.PENDING) ||
      !challenge ||
      challenge.id !== challengeId ||
      challenge.generation !== generation ||
      !challengeStateMatches
    ) {
      await this.complete({
        action_type: request.action_type,
        challenge_id: challengeId,
        generation,
        notified: false,
        reason,
        stale: true,
        target_user_id: command.targetUserId,
        verification_event_id: command.caseId,
      });
      return;
    }
    const presented = await this.requireCaptchaStatusPresentation(
      request,
      verificationEvent,
      challenge,
      reason
    );
    await this.complete({
      action_type: request.action_type,
      challenge_id: challengeId,
      generation,
      ...(reason === 'cancelled' || reason === 'bypassed'
        ? { presented }
        : { notified: presented }),
      reason,
      ...(!presented ? { stale: true } : {}),
      target_user_id: command.targetUserId,
      verification_event_id: command.caseId,
    });
  }

  private readMetadataString(metadata: unknown, key: string): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  private readMetadataRecord(metadata: unknown, key: string): Record<string, unknown> | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    const value = (metadata as Record<string, unknown>)[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}

function matchesRecordedCaptchaMutation({
  challenge,
  operation,
  generation,
  actorId,
  reason,
}: {
  readonly challenge: CaptchaChallenge;
  readonly operation: 'request' | 'retry' | 'bypass';
  readonly generation: number;
  readonly actorId: string;
  readonly reason: string | null;
}): boolean {
  const generationHistory = challenge.history?.find((entry) => entry.generation === generation);
  const currentGeneration = challenge.generation === generation;
  const expectedBypassReason = reason?.trim().slice(0, 1000);
  const requestMatches =
    operation !== 'bypass' &&
    ((generationHistory?.request_source === CaptchaChallengeRequestSource.MODERATOR &&
      generationHistory.requested_by === actorId) ||
      (currentGeneration &&
        challenge.request_source === CaptchaChallengeRequestSource.MODERATOR &&
        challenge.requested_by === actorId));
  const bypassMatches =
    operation === 'bypass' &&
    ((generationHistory?.bypassed_by === actorId &&
      generationHistory.bypass_reason === expectedBypassReason) ||
      (currentGeneration &&
        challenge.status === CaptchaChallengeStatus.BYPASSED &&
        challenge.bypassed_by === actorId &&
        challenge.bypass_reason === expectedBypassReason));
  return requestMatches || bypassMatches;
}
