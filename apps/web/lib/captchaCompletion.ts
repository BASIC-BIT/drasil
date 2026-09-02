import { createHash, createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { CAPTCHA_DEFAULT_MAX_SUBMISSIONS } from '@drasil/contracts';
import { requireEnv } from './env';
import { insertModerationActionRequestWithReceipt } from './moderationActionRequestQueue';
import { getPostgresPool } from './setupDataAdapter';
import type { CaptchaIdentity } from './captchaSession';
import type { SanitizedTurnstileResult } from './turnstile';

const CAPTCHA_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CAPTCHA_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPTCHA_ATTEMPT_RATE_WINDOW_MS = 60_000;
const CAPTCHA_ATTEMPT_RATE_LIMIT = 10;
const CAPTCHA_CHALLENGE_ATTEMPT_LIMIT = 100;
const CAPTCHA_ATTEMPT_ABANDONED_AFTER_MS = 60_000;
const CAPTCHA_SYSTEM_ACTOR_ID = 'drasil:captcha';

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
  readonly case_status: string;
  readonly case_kind: string;
  readonly server_settings: unknown;
}

interface CaptchaAttemptRow {
  readonly id: string;
  readonly validation_state:
    | 'started'
    | 'identity_mismatch'
    | 'invalid'
    | 'passed'
    | 'provider_error'
    | 'stale';
}

interface CaptchaCompletionRow extends CaptchaChallengeRow {
  readonly attempt_id: string;
  readonly attempt_generation: number;
  readonly validation_state: CaptchaAttemptRow['validation_state'];
}

export interface CaptchaPublicChallenge {
  readonly id: string;
  readonly verificationEventId: string;
  readonly serverId: string;
  readonly userId: string;
  readonly status: CaptchaPublicStatus;
  readonly generation: number;
  readonly caseRevision: number;
  readonly expiresAt: Date;
}

export interface CaptchaAttemptStartResult {
  readonly state:
    | 'ready'
    | 'duplicate'
    | 'identity_mismatch'
    | 'rate_limited'
    | 'stale'
    | 'unavailable';
  readonly attemptId?: string;
  readonly previousState?: CaptchaAttemptRow['validation_state'];
  readonly challenge?: CaptchaPublicChallenge;
}

export type CaptchaAttemptCompletionState =
  | 'passed'
  | 'invalid'
  | 'failed'
  | 'provider_error'
  | 'stale';

function hashToken(token: string): string | null {
  return CAPTCHA_TOKEN_PATTERN.test(token)
    ? createHash('sha256').update(token).digest('hex')
    : null;
}

function toPublicChallenge(row: CaptchaChallengeRow): CaptchaPublicChallenge {
  const expired = row.status === 'pending' && row.expires_at.getTime() <= Date.now();
  const featureDisabled =
    row.status === 'pending' && readCaptchaMode(row.server_settings) === 'off';
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
  const value = (settings as Record<string, unknown>).captcha_mode;
  return value === 'manual' || value === 'suspicious_join' ? value : 'off';
}

async function selectChallenge(
  client: Pool | PoolClient,
  tokenHash: string,
  forUpdate = false
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
       v.status::text as case_status,
       v.case_kind::text as case_kind,
       coalesce(s.settings, '{}'::jsonb) as server_settings
     from captcha_challenges c
     join verification_events v on v.id = c.verification_event_id
     join servers s on s.guild_id = c.server_id
     where c.link_token_hash = $1
     ${forUpdate ? 'for update of c' : ''}`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

function readCaptchaMaxSubmissions(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return CAPTCHA_DEFAULT_MAX_SUBMISSIONS;
  }
  const value = (settings as Record<string, unknown>).captcha_max_submissions;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : CAPTCHA_DEFAULT_MAX_SUBMISSIONS;
}

function stateForExistingAttempt(
  state: CaptchaAttemptRow['validation_state']
): CaptchaAttemptCompletionState {
  switch (state) {
    case 'passed':
      return 'passed';
    case 'invalid':
    case 'identity_mismatch':
      return 'invalid';
    case 'provider_error':
      return 'provider_error';
    case 'stale':
    case 'started':
      return 'stale';
  }
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

export async function requeueCaptchaPassEffect(challenge: CaptchaPublicChallenge): Promise<void> {
  if (challenge.status !== 'passed') {
    return;
  }
  await insertModerationActionRequestWithReceipt(getPostgresPool(), {
    actionType: 'apply_captcha_pass',
    actorId: CAPTCHA_SYSTEM_ACTOR_ID,
    actorSurface: 'captcha',
    idempotencyKey: `captcha:apply:${challenge.id}:${challenge.generation}`,
    metadata: {
      challenge_id: challenge.id,
      generation: challenge.generation,
      expected_case_revision: challenge.caseRevision,
    },
    serverId: challenge.serverId,
    targetUserId: challenge.userId,
    verificationEventId: challenge.verificationEventId,
  });
}

export async function getCaptchaPublicChallenge(
  token: string
): Promise<CaptchaPublicChallenge | null> {
  const tokenHash = hashToken(token);
  if (!tokenHash) {
    return null;
  }
  const row = await selectChallenge(getPostgresPool(), tokenHash);
  return row ? toPublicChallenge(row) : null;
}

async function insertAttempt(
  client: PoolClient,
  input: {
    readonly challenge: CaptchaChallengeRow;
    readonly discordUserId: string;
    readonly idempotencyKey: string;
    readonly validationState: 'started' | 'identity_mismatch';
  }
): Promise<CaptchaAttemptRow | null> {
  const inserted = await client.query<CaptchaAttemptRow>(
    `insert into captcha_challenge_attempts (
       captcha_challenge_id,
       generation,
       submission_number,
       consumes_submission,
       idempotency_key,
       validation_state,
       discord_user_id,
       validated_at
     )
     select
       $1::uuid,
       $2,
       coalesce(max(submission_number), 0) + 1,
       false,
       $3,
       $4::captcha_attempt_validation_state,
       $5,
       case when $4 = 'identity_mismatch' then now() else null end
     from captcha_challenge_attempts
     where captcha_challenge_id = $1::uuid and generation = $2
     on conflict (idempotency_key) do nothing
     returning id::text, validation_state::text as validation_state`,
    [
      input.challenge.id,
      input.challenge.generation,
      input.idempotencyKey,
      input.validationState,
      input.discordUserId,
    ]
  );
  return inserted.rows[0] ?? null;
}

async function findAttemptByIdempotencyKey(
  client: PoolClient,
  idempotencyKey: string
): Promise<CaptchaAttemptRow | null> {
  const result = await client.query<CaptchaAttemptRow>(
    `select id::text, validation_state::text as validation_state
     from captcha_challenge_attempts
     where idempotency_key = $1`,
    [idempotencyKey]
  );
  return result.rows[0] ?? null;
}

async function readAttemptLimits(
  client: PoolClient,
  challenge: CaptchaChallengeRow,
  discordUserId: string
): Promise<{ generationCount: number; recentUserCount: number }> {
  // A process exit or provider setup exception can strand a committed attempt before validation.
  // Retire it after the provider request's bounded lifetime so infrastructure failures cannot
  // permanently exhaust the generation cap.
  await client.query(
    `update captcha_challenge_attempts
     set validation_state = 'provider_error',
         provider_success = null,
         provider_error_codes = array['internal-error']::text[],
         validated_at = now()
     where captcha_challenge_id = $1::uuid
       and generation = $2
       and validation_state = 'started'
       and created_at < $3::timestamptz`,
    [challenge.id, challenge.generation, new Date(Date.now() - CAPTCHA_ATTEMPT_ABANDONED_AFTER_MS)]
  );
  const result = await client.query<{
    generation_count: string;
    recent_user_count: string;
  }>(
    `select
       (
         select count(*)::text
         from captcha_challenge_attempts
         where captcha_challenge_id = $1::uuid
           and generation = $2
           and validation_state <> 'provider_error'::captcha_attempt_validation_state
       ) as generation_count,
       (
         select count(*)::text
         from captcha_challenge_attempts
         where discord_user_id = $3
           and created_at >= $4::timestamptz
       ) as recent_user_count`,
    [
      challenge.id,
      challenge.generation,
      discordUserId,
      new Date(Date.now() - CAPTCHA_ATTEMPT_RATE_WINDOW_MS),
    ]
  );
  const counts = result.rows[0];
  return {
    generationCount: Number(counts?.generation_count ?? 0),
    recentUserCount: Number(counts?.recent_user_count ?? 0),
  };
}

async function lockCaptchaAttemptUser(client: PoolClient, discordUserId: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [discordUserId]);
}

async function failExhaustedGeneration(
  client: PoolClient,
  challenge: CaptchaChallengeRow
): Promise<void> {
  const failed = await client.query<{ id: string }>(
    `update captcha_challenges
     set status = 'failed', updated_at = now()
     where id = $1::uuid and generation = $2 and status = 'pending'
     returning id::text`,
    [challenge.id, challenge.generation]
  );
  if (!failed.rows[0]) {
    return;
  }
  await insertModerationActionRequestWithReceipt(client, {
    actionType: 'notify_captcha_attention',
    actorId: CAPTCHA_SYSTEM_ACTOR_ID,
    actorSurface: 'captcha',
    idempotencyKey: `captcha:attention:${challenge.id}:${challenge.generation}:submission-limit`,
    metadata: {
      challenge_id: challenge.id,
      generation: challenge.generation,
      reason: 'submission_limit',
    },
    serverId: challenge.server_id,
    targetUserId: challenge.user_id,
    verificationEventId: challenge.verification_event_id,
  });
}

export async function recordCaptchaIdentityMismatch(input: {
  readonly token: string;
  readonly discordUserId: string;
  readonly idempotencyKey: string;
}): Promise<void> {
  const tokenHash = hashToken(input.token);
  if (!tokenHash) {
    return;
  }
  const client = await getPostgresPool().connect();
  try {
    await client.query('begin');
    const challenge = await selectChallenge(client, tokenHash, true);
    if (challenge && toPublicChallenge(challenge).status === 'pending') {
      await lockCaptchaAttemptUser(client, input.discordUserId);
      const limits = await readAttemptLimits(client, challenge, input.discordUserId);
      if (
        limits.recentUserCount < CAPTCHA_ATTEMPT_RATE_LIMIT &&
        limits.generationCount < CAPTCHA_CHALLENGE_ATTEMPT_LIMIT
      ) {
        const inserted = await insertAttempt(client, {
          challenge,
          discordUserId: input.discordUserId,
          idempotencyKey: input.idempotencyKey,
          validationState: 'identity_mismatch',
        });
        if (inserted && limits.generationCount + 1 >= CAPTCHA_CHALLENGE_ATTEMPT_LIMIT) {
          await failExhaustedGeneration(client, challenge);
        }
      } else if (limits.generationCount >= CAPTCHA_CHALLENGE_ATTEMPT_LIMIT) {
        await failExhaustedGeneration(client, challenge);
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function beginCaptchaAttempt(input: {
  readonly token: string;
  readonly identity: CaptchaIdentity;
  readonly idempotencyKey: string;
}): Promise<CaptchaAttemptStartResult> {
  const tokenHash = hashToken(input.token);
  if (!tokenHash || !CAPTCHA_ATTEMPT_ID_PATTERN.test(input.idempotencyKey)) {
    return { state: 'unavailable' };
  }
  const client = await getPostgresPool().connect();
  try {
    await client.query('begin');
    const challenge = await selectChallenge(client, tokenHash, true);
    if (!challenge) {
      await client.query('commit');
      return { state: 'unavailable' };
    }
    const publicChallenge = toPublicChallenge(challenge);
    if (publicChallenge.status !== 'pending') {
      await client.query('commit');
      return { state: 'stale', challenge: publicChallenge };
    }
    if (
      input.identity.challengeId !== challenge.id ||
      input.identity.generation !== challenge.generation ||
      input.identity.userId !== challenge.user_id
    ) {
      await client.query('commit');
      return { state: 'identity_mismatch', challenge: publicChallenge };
    }
    const existing = await findAttemptByIdempotencyKey(client, input.idempotencyKey);
    if (existing) {
      await client.query('commit');
      return {
        state: 'duplicate',
        attemptId: existing.id,
        previousState: existing.validation_state,
        challenge: publicChallenge,
      };
    }
    await lockCaptchaAttemptUser(client, input.identity.userId);
    const limits = await readAttemptLimits(client, challenge, input.identity.userId);
    if (limits.generationCount >= CAPTCHA_CHALLENGE_ATTEMPT_LIMIT) {
      await failExhaustedGeneration(client, challenge);
      await client.query('commit');
      return { state: 'stale', challenge: { ...publicChallenge, status: 'failed' } };
    }
    if (limits.recentUserCount >= CAPTCHA_ATTEMPT_RATE_LIMIT) {
      await client.query('commit');
      return { state: 'rate_limited', challenge: publicChallenge };
    }
    const attempt = await insertAttempt(client, {
      challenge,
      discordUserId: input.identity.userId,
      idempotencyKey: input.idempotencyKey,
      validationState: 'started',
    });
    if (!attempt) {
      const duplicate = await findAttemptByIdempotencyKey(client, input.idempotencyKey);
      await client.query('commit');
      return {
        state: 'duplicate',
        attemptId: duplicate?.id,
        previousState: duplicate?.validation_state,
        challenge: publicChallenge,
      };
    }
    if (limits.generationCount + 1 >= CAPTCHA_CHALLENGE_ATTEMPT_LIMIT) {
      await client.query(
        `update captcha_challenge_attempts
         set validation_state = 'stale', validated_at = now()
         where id = $1::uuid and validation_state = 'started'`,
        [attempt.id]
      );
      await failExhaustedGeneration(client, challenge);
      await client.query('commit');
      return { state: 'stale', challenge: { ...publicChallenge, status: 'failed' } };
    }
    await client.query('commit');
    return { state: 'ready', attemptId: attempt.id, challenge: publicChallenge };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function completeCaptchaAttempt(input: {
  readonly attemptId: string;
  readonly validation: SanitizedTurnstileResult;
}): Promise<CaptchaAttemptCompletionState> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('begin');
    const result = await client.query<CaptchaCompletionRow>(
      `select
         a.id::text as attempt_id,
         a.validation_state::text as validation_state,
         a.generation as attempt_generation,
         c.id::text as id,
         c.verification_event_id::text,
         c.server_id,
         c.user_id,
         c.status::text as status,
         c.generation,
         c.case_revision_at_issue,
         c.expires_at,
         c.submission_count,
         v.status::text as case_status,
         v.case_kind::text as case_kind,
         coalesce(s.settings, '{}'::jsonb) as server_settings
       from captcha_challenge_attempts a
       join captcha_challenges c on c.id = a.captcha_challenge_id
       join verification_events v on v.id = c.verification_event_id
       join servers s on s.guild_id = c.server_id
       where a.id = $1::uuid
       for update of a, c, v, s`,
      [input.attemptId]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('commit');
      return 'stale';
    }
    if (row.validation_state !== 'started') {
      await client.query('commit');
      return stateForExistingAttempt(row.validation_state);
    }
    if (
      row.status !== 'pending' ||
      row.case_status !== 'pending' ||
      row.case_kind !== 'standard' ||
      readCaptchaMode(row.server_settings) === 'off' ||
      row.attempt_generation !== row.generation ||
      row.expires_at.getTime() <= Date.now()
    ) {
      await client.query(
        `update captcha_challenge_attempts
         set validation_state = 'stale', validated_at = now()
         where id = $1::uuid and validation_state = 'started'`,
        [input.attemptId]
      );
      await client.query('commit');
      return 'stale';
    }

    await client.query(
      `update captcha_challenge_attempts
       set validation_state = $2::captcha_attempt_validation_state,
           consumes_submission = $3,
           provider_success = $4,
           provider_action = $5,
           provider_hostname = $6,
           provider_error_codes = $7::text[],
           validated_at = now()
       where id = $1::uuid and validation_state = 'started'`,
      [
        input.attemptId,
        input.validation.state,
        input.validation.state === 'invalid',
        input.validation.success,
        input.validation.action?.slice(0, 100) ?? null,
        input.validation.hostname?.slice(0, 255) ?? null,
        [...input.validation.errorCodes].slice(0, 12),
      ]
    );

    if (input.validation.state === 'provider_error') {
      await client.query('commit');
      return 'provider_error';
    }
    if (input.validation.state === 'invalid') {
      const nextSubmissionCount = row.submission_count + 1;
      const failed = nextSubmissionCount >= readCaptchaMaxSubmissions(row.server_settings);
      await client.query(
        `update captcha_challenges
         set submission_count = $2,
             status = case when $3 then 'failed'::captcha_challenge_status else status end,
             updated_at = now()
         where id = $1::uuid and generation = $4 and status = 'pending'`,
        [row.id, nextSubmissionCount, failed, row.generation]
      );
      if (failed) {
        await insertModerationActionRequestWithReceipt(client, {
          actionType: 'notify_captcha_attention',
          actorId: CAPTCHA_SYSTEM_ACTOR_ID,
          actorSurface: 'captcha',
          idempotencyKey: `captcha:attention:${row.id}:${row.generation}:submission-limit`,
          metadata: {
            challenge_id: row.id,
            generation: row.generation,
            reason: 'submission_limit',
          },
          serverId: row.server_id,
          targetUserId: row.user_id,
          verificationEventId: row.verification_event_id,
        });
      }
      await client.query('commit');
      return failed ? 'failed' : 'invalid';
    }

    const passed = await client.query<{ id: string }>(
      `update captcha_challenges
       set status = 'passed', passed_at = now(), updated_at = now()
       where id = $1::uuid and generation = $2 and status = 'pending'
       returning id::text`,
      [row.id, row.generation]
    );
    if (!passed.rows[0]) {
      await client.query(
        `update captcha_challenge_attempts
         set validation_state = 'stale', validated_at = now()
         where id = $1::uuid and validation_state = 'passed'`,
        [input.attemptId]
      );
      await client.query('commit');
      return 'stale';
    }
    await insertModerationActionRequestWithReceipt(client, {
      actionType: 'apply_captcha_pass',
      actorId: CAPTCHA_SYSTEM_ACTOR_ID,
      actorSurface: 'captcha',
      idempotencyKey: `captcha:apply:${row.id}:${row.generation}`,
      metadata: {
        challenge_id: row.id,
        generation: row.generation,
        expected_case_revision: row.case_revision_at_issue,
      },
      serverId: row.server_id,
      targetUserId: row.user_id,
      verificationEventId: row.verification_event_id,
    });
    await client.query('commit');
    return 'passed';
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
