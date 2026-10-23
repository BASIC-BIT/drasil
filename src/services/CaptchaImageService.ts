import { createHash } from 'node:crypto';
import { decodeCaptchaImageSecret, type ActionContext } from '@drasil/application';
import type { CaptchaCompletionStore } from '@drasil/application/postgres';
import type {
  CaptchaImageBinding,
  ICaptchaChallengeRepository,
} from '../repositories/CaptchaChallengeRepository';
import type { CaptchaChallenge } from '../repositories/types';
import {
  generateImageAnswer,
  digestImageAnswer,
  verifyImageAnswer,
  imageAnswerKeyVersion,
} from './captcha/imageAnswer';
import type { CaptchaImageRenderer } from './captcha/imageRenderer';

export interface ImageChallengeReference {
  challengeId: string;
  generation: number;
}
export type ImageOpenOutcome =
  | { kind: 'ready'; png: Buffer }
  | { kind: 'denied' | 'stale' | 'unavailable' };
export type ImageSubmitOutcome =
  | { kind: 'invalid'; remainingAttempts: number }
  | { kind: 'passed' | 'failed' | 'denied' | 'stale' | 'rate_limited' | 'unavailable' };
export interface ImageSubmitInput extends ImageChallengeReference {
  interactionId: string;
  answer: string;
}
export interface ICaptchaImageService {
  open(context: ActionContext, reference: ImageChallengeReference): Promise<ImageOpenOutcome>;
  submit(context: ActionContext, input: ImageSubmitInput): Promise<ImageSubmitOutcome>;
}
export interface CaptchaImageDependencies {
  challenges: Pick<
    ICaptchaChallengeRepository,
    | 'findById'
    | 'isImageBindingEligible'
    | 'findImageMaterial'
    | 'storeImageMaterial'
    | 'invalidateImageMaterial'
  >;
  completion: Pick<CaptchaCompletionStore, 'beginAttempt' | 'completeAttempt'>;
  renderer: CaptchaImageRenderer;
  secret(): string | undefined;
  maxSubmissions(serverId: string): Promise<number>;
}
function bindingFor(challenge: CaptchaChallenge): CaptchaImageBinding {
  return {
    challengeId: challenge.id,
    generation: challenge.generation,
    serverId: challenge.server_id,
    userId: challenge.user_id,
    verificationEventId: challenge.verification_event_id,
    caseRevision: challenge.case_revision_at_issue,
    methodRevision: challenge.method_revision,
  };
}
/**
 * Only the active canonical-base64 image secret is loaded. Its decoded bytes
 * identify the key by SHA-256; no previous-key registry is retained. On access,
 * another fingerprint erases the image and marks the generation for moderator
 * reissue. Rotation never spends an answer attempt or regenerates that generation.
 */
export class CaptchaImageService implements ICaptchaImageService {
  constructor(private readonly deps: CaptchaImageDependencies) {}

  private async authorize(
    context: ActionContext,
    reference: ImageChallengeReference
  ): Promise<{ kind: 'authorized'; binding: CaptchaImageBinding } | { kind: 'denied' | 'stale' }> {
    if (context.actor.kind !== 'user') return { kind: 'denied' };
    if (!Number.isInteger(reference.generation) || reference.generation < 1)
      return { kind: 'stale' };
    const challenge = await this.deps.challenges.findById(reference.challengeId);
    if (!challenge) return { kind: 'stale' };
    if (challenge.server_id !== context.guildId || challenge.user_id !== context.actor.userId)
      return { kind: 'denied' };
    if (
      challenge.provider !== 'discord_image' ||
      challenge.generation !== reference.generation ||
      challenge.status !== 'pending' ||
      challenge.expires_at.getTime() <= Date.now() ||
      challenge.delivery_error_code === 'image_key_rotated'
    )
      return { kind: 'stale' };
    const binding = bindingFor(challenge);
    if (!(await this.deps.challenges.isImageBindingEligible(binding))) return { kind: 'stale' };
    return { kind: 'authorized', binding };
  }

  public async open(
    context: ActionContext,
    reference: ImageChallengeReference
  ): Promise<ImageOpenOutcome> {
    try {
      const authorized = await this.authorize(context, reference);
      if (authorized.kind !== 'authorized') return authorized;
      const key = decodeCaptchaImageSecret(this.deps.secret());
      if (!key) return { kind: 'unavailable' };
      const keyVersion = imageAnswerKeyVersion(key);
      const stored = await this.deps.challenges.findImageMaterial(authorized.binding);
      if (stored) {
        if (stored.key_version !== keyVersion) {
          await this.deps.challenges.invalidateImageMaterial(authorized.binding, keyVersion);
          return { kind: 'stale' };
        }
        return { kind: 'ready', png: Buffer.from(stored.png) };
      }
      const answer = generateImageAnswer();
      const png = await this.deps.renderer.render(answer);
      const answerBinding = {
        ...authorized.binding,
        caseId: authorized.binding.verificationEventId,
      };
      await this.deps.challenges.storeImageMaterial({
        ...authorized.binding,
        png,
        answerDigest: digestImageAnswer(answerBinding, answer, key),
        keyVersion,
      });
      // Always load the winner. A lost render must never reach the member.
      const winner = await this.deps.challenges.findImageMaterial(authorized.binding);
      if (!winner) return { kind: 'stale' };
      if (winner.key_version !== keyVersion) {
        await this.deps.challenges.invalidateImageMaterial(authorized.binding, keyVersion);
        return { kind: 'stale' };
      }
      return { kind: 'ready', png: Buffer.from(winner.png) };
    } catch {
      // Renderer/storage exceptions can contain the answer or secrets. Do not log them.
      return { kind: 'unavailable' };
    }
  }

  public async submit(
    context: ActionContext,
    input: ImageSubmitInput
  ): Promise<ImageSubmitOutcome> {
    try {
      const authorized = await this.authorize(context, input);
      if (authorized.kind !== 'authorized') return authorized;
      const key = decodeCaptchaImageSecret(this.deps.secret());
      if (!key) return { kind: 'unavailable' };
      const keyVersion = imageAnswerKeyVersion(key);
      const material = await this.deps.challenges.findImageMaterial(authorized.binding);
      if (!material) return { kind: 'stale' };
      if (material.key_version !== keyVersion) {
        await this.deps.challenges.invalidateImageMaterial(authorized.binding, keyVersion);
        return { kind: 'stale' };
      }
      if (!input.interactionId || input.interactionId !== context.requestId)
        return { kind: 'denied' };
      const maxSubmissions = await this.deps.maxSubmissions(context.guildId);
      const attempt = await this.deps.completion.beginAttempt(context, {
        challengeId: input.challengeId,
        generation: input.generation,
        provider: 'discord_image',
        idempotencyKey: `discord-image:${createHash('sha256').update(input.interactionId).digest('hex')}`,
      });
      if (attempt.state === 'identity_mismatch') return { kind: 'denied' };
      if (attempt.state === 'rate_limited') return { kind: 'rate_limited' };
      if (attempt.state === 'stale') return { kind: 'stale' };
      if (!attempt.attemptId || attempt.state === 'unavailable') return { kind: 'unavailable' };
      if (attempt.state === 'duplicate' && attempt.previousState !== 'invalid')
        return { kind: attempt.previousState === 'stale' ? 'stale' : 'unavailable' };
      const passed = verifyImageAnswer(
        { ...authorized.binding, caseId: authorized.binding.verificationEventId },
        input.answer,
        key,
        material.answer_digest
      );
      const completed = await this.deps.completion.completeAttempt(context, {
        provider: 'discord_image',
        challengeId: input.challengeId,
        generation: input.generation,
        attemptId: attempt.attemptId,
        imageIssuance: {
          keyVersion,
          answerDigest: Buffer.from(material.answer_digest).toString('hex'),
        },
        validation: {
          state: passed ? 'passed' : 'invalid',
          success: passed,
          action: null,
          hostname: null,
          errorCodes: [],
        },
      });
      if (completed === 'provider_error') return { kind: 'unavailable' };
      if (completed !== 'invalid') return { kind: completed };
      const current = await this.deps.challenges.findById(input.challengeId);
      if (!current || current.generation !== input.generation) return { kind: 'stale' };
      return {
        kind: 'invalid',
        remainingAttempts: Math.max(0, maxSubmissions - current.submission_count),
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
