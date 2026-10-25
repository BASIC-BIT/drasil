import { createWebCaptchaApplication } from './application/createWebApplication';
import type {
  ActionContext,
  CaptchaBrowserActions,
  CaptchaCompletionInput,
  CaptchaAttemptStart,
  CaptchaAttemptCompletion,
  CaptchaBrowserChallenge,
} from '@drasil/application';
import {
  requireCaptchaBrowserOutcome,
  createCaptchaPassContext,
} from './application/adapters/captcha';
import { createHash, createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getEffectiveCaptchaMethod } from '@drasil/application';
import { createCaptchaCompletionStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './mcp/adapters/database';
import { requireEnv } from './env';
import { getPostgresPool } from './setupDataAdapter';
import type { CaptchaIdentity } from './captchaSession';

const CAPTCHA_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CAPTCHA_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type CaptchaPublicStatus =
  | 'pending'
  | 'passed'
  | 'failed'
  | 'expired'
  | 'bypassed'
  | 'cancelled'
  | 'unavailable';

interface CaptchaChallengeRow {
  readonly id: string;
  readonly verification_event_id: string;
  readonly server_id: string;
  readonly user_id: string;
  readonly status: Exclude<CaptchaPublicStatus, 'unavailable'>;
  readonly generation: number;
  readonly case_revision_at_issue: number;
  readonly expires_at: Date;
  readonly submission_count: number;
  readonly provider: 'turnstile' | 'discord_image';
  readonly method_revision: number;
  readonly case_status: string;
  readonly case_kind: string;
  readonly server_settings: unknown;
}

export type CaptchaPublicChallenge = CaptchaBrowserChallenge;
export type CaptchaAttemptStartResult = CaptchaAttemptStart;
export type CaptchaAttemptCompletionState = CaptchaAttemptCompletion;

function hashToken(token: string): string | null {
  return CAPTCHA_TOKEN_PATTERN.test(token)
    ? createHash('sha256').update(token).digest('hex')
    : null;
}

function toPublicChallenge(row: CaptchaChallengeRow): CaptchaPublicChallenge {
  const expired = row.status === 'pending' && row.expires_at.getTime() <= Date.now();
  const featureDisabled =
    row.status === 'pending' &&
    (readCaptchaMode(row.server_settings) === 'off' ||
      getEffectiveCaptchaMethod(row.server_settings) !== 'turnstile' ||
      methodRevision(row.server_settings) !== row.method_revision);
  const caseUnavailable =
    row.status === 'pending' &&
    (row.case_status !== 'pending' || row.case_kind !== 'standard' || featureDisabled);
  return {
    id: row.id,
    verificationEventId: row.verification_event_id,
    serverId: row.server_id,
    userId: row.user_id,
    status: expired ? 'expired' : caseUnavailable ? 'cancelled' : row.status,
    generation: row.generation,
    caseRevision: row.case_revision_at_issue,
    expiresAt: row.expires_at,
  };
}

function readCaptchaMode(settings: unknown): 'off' | 'manual' | 'suspicious_join' {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return 'off';
  }
  const value = 'captcha_mode' in settings ? settings.captcha_mode : undefined;
  return value === 'manual' || value === 'suspicious_join' ? value : 'off';
}

async function selectChallenge(
  client: Pool | PoolClient,
  tokenHash: string
): Promise<CaptchaChallengeRow | null> {
  const result = await client.query<CaptchaChallengeRow>(
    `select
       c.id::text,
       c.verification_event_id::text,
       c.server_id,
       c.user_id,
       c.status::text as status,
       c.generation,
       c.case_revision_at_issue,
       c.expires_at,
       c.submission_count,
       c.provider::text,
       c.method_revision,
       v.status::text as case_status,
       v.case_kind::text as case_kind,
       coalesce(s.settings, '{}'::jsonb) as server_settings
     from captcha_challenges c
     join verification_events v on v.id = c.verification_event_id
     join servers s on s.guild_id = c.server_id
     where c.link_token_hash = $1
     and c.provider = 'turnstile'::captcha_provider`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

function methodRevision(settings: unknown): unknown {
  return settings && typeof settings === 'object' && 'captcha_method_revision' in settings
    ? settings.captcha_method_revision
    : 0;
}

export function getTurnstileSiteKey(): string {
  return requireEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
}

export function buildCaptchaCdata(challengeId: string, generation: number): string {
  return createHmac('sha256', requireEnv('DRASIL_CAPTCHA_BINDING_SECRET'))
    .update(`${challengeId}:${generation}`)
    .digest('base64url');
}

export function getCaptchaFormConfiguration(
  challengeId: string,
  generation: number
): { readonly cdata: string; readonly siteKey: string } | null {
  try {
    return {
      cdata: buildCaptchaCdata(challengeId, generation),
      siteKey: getTurnstileSiteKey(),
    };
  } catch {
    return null;
  }
}

export async function getCaptchaPublicChallenge(
  token: string
): Promise<CaptchaPublicChallenge | null> {
  const tokenHash = hashToken(token);
  if (!tokenHash) {
    return null;
  }
  const row = await selectChallenge(getPostgresPool(), tokenHash);
  return row && row.provider === 'turnstile' ? toPublicChallenge(row) : null;
}

// The token stays at this boundary. Shared transactions accept only persisted references.
function browserActions(token: string): CaptchaBrowserActions {
  const store = createCaptchaCompletionStore(createWebDelegationDatabase());
  async function matchesToken(input: {
    readonly challengeId: string;
    readonly generation: number;
  }): Promise<boolean> {
    const challenge = await getCaptchaPublicChallenge(token);
    return challenge?.id === input.challengeId && challenge.generation === input.generation;
  }
  return createWebCaptchaApplication({
    async beginAttempt(context, input) {
      if (!CAPTCHA_ATTEMPT_ID_PATTERN.test(input.idempotencyKey) || !(await matchesToken(input)))
        return { state: 'unavailable' };
      return store.beginAttempt(context, { ...input, provider: 'turnstile' });
    },
    async recordIdentityMismatch(context, input) {
      if (await matchesToken(input))
        await store.recordIdentityMismatch(context, { ...input, provider: 'turnstile' });
    },
    async completeAttempt(context, input) {
      const completed = await store.completeAttempt(context, input);
      return typeof completed === 'string' ? completed : completed.state;
    },
    requeuePassEffect: (context, input) => store.requeuePassEffect(context, input),
  }).captcha;
}
function authenticatedCaptchaUser(context: ActionContext): string {
  if (context.actor.kind !== 'user') throw new Error('Security-check identity is unavailable.');
  return context.actor.userId;
}
export async function beginCaptchaAttempt(
  context: ActionContext,
  input: {
    readonly token: string;
    readonly identity: CaptchaIdentity;
    readonly idempotencyKey: string;
  }
): Promise<CaptchaAttemptStartResult> {
  if (authenticatedCaptchaUser(context) !== input.identity.userId)
    return { state: 'identity_mismatch' };
  return requireCaptchaBrowserOutcome(
    await browserActions(input.token).beginAttempt(context, {
      challengeId: input.identity.challengeId,
      generation: input.identity.generation,
      idempotencyKey: input.idempotencyKey,
    })
  );
}
export async function recordCaptchaIdentityMismatch(
  context: ActionContext,
  input: {
    readonly token: string;
    readonly discordUserId: string;
    readonly idempotencyKey: string;
    readonly challengeId: string;
    readonly generation: number;
  }
): Promise<void> {
  if (authenticatedCaptchaUser(context) !== input.discordUserId)
    throw new Error('Security-check identity is unavailable.');
  return requireCaptchaBrowserOutcome(
    await browserActions(input.token).recordIdentityMismatch(context, {
      challengeId: input.challengeId,
      generation: input.generation,
      idempotencyKey: input.idempotencyKey,
    })
  );
}
export async function completeCaptchaAttempt(
  context: ActionContext,
  input: CaptchaCompletionInput
): Promise<CaptchaAttemptCompletionState> {
  if (input.provider !== 'turnstile') return 'stale';
  return requireCaptchaBrowserOutcome(await browserActions('').completeAttempt(context, input));
}
export async function requeueCaptchaPassEffect(challenge: CaptchaPublicChallenge): Promise<void> {
  if (challenge.status !== 'passed') return;
  return requireCaptchaBrowserOutcome(
    await browserActions('').requeuePassEffect(createCaptchaPassContext(challenge), {
      challengeId: challenge.id,
      generation: challenge.generation,
      caseId: challenge.verificationEventId,
      targetUserId: challenge.userId,
      expectedCaseRevision: challenge.caseRevision,
    })
  );
}
