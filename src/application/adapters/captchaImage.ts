import type { ActionContext, ActionResult } from '@drasil/application';
import type {
  ICaptchaImageService,
  ImageChallengeReference,
  ImageOpenOutcome,
  ImageSubmitInput,
  ImageSubmitOutcome,
} from '../../services/CaptchaImageService';

export type {
  ImageChallengeReference,
  ImageOpenOutcome,
  ImageSubmitInput,
  ImageSubmitOutcome,
} from '../../services/CaptchaImageService';
export interface BotCaptchaImageActions {
  open(
    context: ActionContext,
    reference: ImageChallengeReference
  ): Promise<ActionResult<ImageOpenOutcome>>;
  submit(
    context: ActionContext,
    input: ImageSubmitInput
  ): Promise<ActionResult<ImageSubmitOutcome>>;
}
// Member authentication is independent of moderator authority and delegated commands.
export function createBotCaptchaImageActions(
  service: ICaptchaImageService | null
): BotCaptchaImageActions {
  return {
    async open(context, reference): Promise<ActionResult<ImageOpenOutcome>> {
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      if (!service) return { kind: 'outcome', outcome: { kind: 'unavailable' } };
      return { kind: 'outcome', outcome: await service.open(context, reference) };
    },
    async submit(context, input): Promise<ActionResult<ImageSubmitOutcome>> {
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      if (!service) return { kind: 'outcome', outcome: { kind: 'unavailable' } };
      return { kind: 'outcome', outcome: await service.submit(context, input) };
    },
  };
}
