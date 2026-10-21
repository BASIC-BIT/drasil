import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  hasAuthority,
  hasStaffAuthority,
  MODERATION_PERMISSIONS,
  type AuthorityPort,
} from '../authorization';
import { ActionDeniedError } from '../results';
import { canonicalDigest } from '../delegation/intents';
import type { DelegatedPrincipal } from '../delegation/types';
import type { ReportIntakeState } from './ports';
export interface IntakePromptPrecondition {
  readonly kind: 'intake_prompt';
  readonly intakeId: string;
  readonly guildId: string;
  readonly fingerprint: string;
}
export interface ResolvedIntakeChoice {
  readonly intakeId: string;
  readonly guildId: string;
  readonly threadId: string;
  readonly promptMessageId: string;
  readonly promptToken: string;
  readonly candidateIds: readonly string[];
  readonly precondition: IntakePromptPrecondition;
}
export interface IntakeChoiceDependencies {
  readonly intakes: { load(id: string): Promise<ReportIntakeState | null> };
  readonly authority: AuthorityPort;
  readonly staffRoles: { loadRoleIds(guildId: string): Promise<readonly string[]> };
}
export async function prepareIntakeChoice(
  principal: Pick<DelegatedPrincipal, 'userId'>,
  guildId: string,
  intakeId: string,
  deps: IntakeChoiceDependencies
): Promise<ResolvedIntakeChoice> {
  const intake = await deps.intakes.load(intakeId);
  if (!intake || intake.id !== intakeId || intake.guildId !== guildId)
    throw new ActionDeniedError('binding_mismatch');
  if (intake.reporterId !== principal.userId) {
    const facts = await deps.authority.loadFresh(guildId, principal.userId);
    if (
      !facts?.present ||
      facts.guildId !== guildId ||
      facts.userId !== principal.userId ||
      !(
        hasAuthority(facts, MODERATION_PERMISSIONS) ||
        hasStaffAuthority(facts, await deps.staffRoles.loadRoleIds(guildId))
      )
    )
      throw new ActionDeniedError('permission_denied');
  }
  if (
    intake.claimed ||
    intake.status !== 'needs_reporter_confirmation' ||
    intake.confirmedTargetUserId ||
    !intake.threadId ||
    !intake.promptMessageId ||
    !intake.promptToken
  )
    throw new ActionDeniedError('stale_state');
  return {
    intakeId,
    guildId,
    threadId: intake.threadId,
    promptMessageId: intake.promptMessageId,
    promptToken: intake.promptToken,
    candidateIds: intake.candidateIds,
    precondition: {
      kind: 'intake_prompt',
      intakeId,
      guildId,
      fingerprint: canonicalDigest(intake),
    },
  };
}
const envelopeSchema = z
  .object({
    purpose: z.literal('drasil.intake-choice.v1'),
    guildId: z.string(),
    intakeId: z.string(),
    userId: z.string(),
    clientId: z.string(),
    connectionId: z.string(),
    grantVersion: z.number().int(),
    fingerprint: z.string(),
  })
  .strict();
/** Signed envelopes contain only a digest; prompt secrets always come from the current repository. */
export function createIntakeChoiceReferences(
  deps: IntakeChoiceDependencies & { readonly secret: string }
): {
  issue(
    principal: DelegatedPrincipal,
    guildId: string,
    intakeId: string
  ): Promise<{ reference: string; candidateIds: readonly string[] }>;
  resolveIntakeChoice(
    principal: DelegatedPrincipal,
    reference: string
  ): Promise<ResolvedIntakeChoice>;
} {
  const sign = (body: string): Buffer => createHmac('sha256', deps.secret).update(body).digest();
  return {
    async issue(
      principal: DelegatedPrincipal,
      guildId: string,
      intakeId: string
    ): Promise<{ reference: string; candidateIds: readonly string[] }> {
      const choice = await prepareIntakeChoice(principal, guildId, intakeId, deps);
      const body = Buffer.from(
        JSON.stringify({
          purpose: 'drasil.intake-choice.v1',
          guildId,
          intakeId,
          userId: principal.userId,
          clientId: principal.clientId,
          connectionId: principal.connectionId,
          grantVersion: principal.grantVersion,
          fingerprint: choice.precondition.fingerprint,
        })
      ).toString('base64url');
      return {
        reference: `${body}.${sign(body).toString('base64url')}`,
        candidateIds: choice.candidateIds,
      };
    },
    async resolveIntakeChoice(
      principal: DelegatedPrincipal,
      reference: string
    ): Promise<ResolvedIntakeChoice> {
      if (reference.length > 4096) throw new ActionDeniedError('binding_mismatch');
      const [body, signature, extra] = reference.split('.');
      if (!body || !signature || extra) throw new ActionDeniedError('binding_mismatch');
      const actual = Buffer.from(signature, 'base64url'),
        expected = sign(body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new ActionDeniedError('binding_mismatch');
      const parsed = envelopeSchema.safeParse(
        JSON.parse(Buffer.from(body, 'base64url').toString())
      );
      if (!parsed.success) throw new ActionDeniedError('binding_mismatch');
      const saved = parsed.data;
      if (
        saved.userId !== principal.userId ||
        saved.clientId !== principal.clientId ||
        saved.connectionId !== principal.connectionId ||
        saved.grantVersion !== principal.grantVersion
      )
        throw new ActionDeniedError('binding_mismatch');
      const choice = await prepareIntakeChoice(principal, saved.guildId, saved.intakeId, deps);
      if (choice.precondition.fingerprint !== saved.fingerprint)
        throw new ActionDeniedError('stale_state');
      return choice;
    },
  };
}
