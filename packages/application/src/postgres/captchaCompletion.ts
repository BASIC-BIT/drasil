import type { ActionContext } from '../context';
import type {
  CaptchaAttemptStart,
  CaptchaAttemptCompletion,
  CaptchaBoundAttemptInput,
  CaptchaCompletionInput,
  CaptchaPassReference,
  CaptchaBrowserChallenge,
} from '../containment/captchaBrowser';
import type { DelegationDatabase, DelegationQueryClient } from './delegation';
import { buildEnqueueStatement } from './enqueue';
import { encodeQueuedAction } from '../requests/encode';
import type { CaptchaSystemCommand } from '../containment/captcha';
import { getEffectiveCaptchaMethod, CAPTCHA_DEFAULT_MAX_SUBMISSIONS } from '../setup/settings';
const CAPTCHA_ATTEMPT_RATE_WINDOW_MS = 60_000;
const CAPTCHA_ATTEMPT_RATE_LIMIT = 10;
const CAPTCHA_SERVICE_ATTEMPT_RATE_LIMIT = 100;
const CAPTCHA_CHALLENGE_ATTEMPT_LIMIT = 100;
const CAPTCHA_ATTEMPT_ABANDONED_AFTER_MS = 60_000;
type CaptchaPublicStatus = CaptchaBrowserChallenge['status'];
type CaptchaPublicChallenge = CaptchaBrowserChallenge;
interface CaptchaChallengeRow extends Record<string, unknown> {
  readonly id: string;
  readonly verification_event_id: string;
  readonly server_id: string;
  readonly user_id: string;
  readonly status: Exclude<CaptchaPublicStatus, 'unavailable'>;
  readonly generation: number;
  readonly case_revision_at_issue: number;
  readonly expires_at: Date;
  readonly submission_count: number;
  readonly provider: CaptchaBoundAttemptInput['provider'];
  readonly method_revision: number;
  readonly case_server_id: string;
  readonly case_user_id: string;
  readonly case_status: string;
  readonly case_kind: string;
  readonly server_settings: unknown;
}

interface CaptchaAttemptRow extends Record<string, unknown> {
  readonly captcha_challenge_id: string;
  readonly generation: number;
  readonly discord_user_id: string | null;
  readonly id: string;
  readonly validation_state:
    | 'started'
    | 'identity_mismatch'
    | 'invalid'
    | 'passed'
    | 'provider_error'
    | 'stale';
}

const toPublicChallenge = (row: CaptchaChallengeRow): CaptchaPublicChallenge => {
  const expired = row.status === 'pending' && row.expires_at.getTime() <= Date.now();
  const featureDisabled = row.status === 'pending' && !currentMethodMatches(row);
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
};

function readCaptchaMode(settings: unknown): 'off' | 'manual' | 'suspicious_join' {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return 'off';
  }
  const value = 'captcha_mode' in settings ? settings.captcha_mode : undefined;
  return value === 'manual' || value === 'suspicious_join' ? value : 'off';
}

function readCaptchaMaxSubmissions(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return CAPTCHA_DEFAULT_MAX_SUBMISSIONS;
  }
  const value =
    'captcha_max_submissions' in settings ? settings.captcha_max_submissions : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : CAPTCHA_DEFAULT_MAX_SUBMISSIONS;
}

function stateForExistingAttempt(
  state: CaptchaAttemptRow['validation_state']
): CaptchaAttemptCompletion {
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

function actorId(context: ActionContext): string {
  return context.actor.kind === 'user' ? context.actor.userId : '';
}
async function insertModerationActionRequestWithReceipt(
  client: DelegationQueryClient,
  input: ReturnType<typeof encodeQueuedAction>
): Promise<void> {
  const statement = buildEnqueueStatement(input);
  const result = await client.query(statement.text, statement.values);
  if (!result.rows[0]) throw new Error('Failed to enqueue moderation action request.');
}
function encodeCaptchaEffect(
  guildId: string,
  command: CaptchaSystemCommand
): ReturnType<typeof encodeQueuedAction> {
  return encodeQueuedAction(
    {
      guildId,
      requestId: `${command.challengeId}:${command.generation}`,
      source: 'captcha',
      actor: {
        kind: 'system',
        purpose: command.kind === 'apply_captcha_pass' ? 'captcha_pass' : 'captcha_attention',
      },
    },
    command
  );
}
function currentMethodMatches(row: CaptchaChallengeRow): boolean {
  const settings = row.server_settings;
  const revision =
    settings && typeof settings === 'object' && 'captcha_method_revision' in settings
      ? settings.captcha_method_revision
      : 0;
  return (
    getEffectiveCaptchaMethod(settings) === row.provider &&
    revision === row.method_revision &&
    readCaptchaMode(settings) !== 'off'
  );
}
async function selectChallenge(
  client: DelegationQueryClient,
  challengeId: string
): Promise<CaptchaChallengeRow | null> {
  // Discovery conveys no authority. Lock each parent explicitly before rereading the complete binding.
  const discovered = await client.query<{ server_id: string; verification_event_id: string }>(
    'select server_id, verification_event_id::text from captcha_challenges where id = $1::uuid',
    [challengeId]
  );
  const binding = discovered.rows[0];
  if (!binding) return null;
  await client.query('select guild_id from servers where guild_id = $1 for update', [
    binding.server_id,
  ]);
  await client.query('select id from verification_events where id = $1::uuid for update', [
    binding.verification_event_id,
  ]);
  await client.query('select id from captcha_challenges where id = $1::uuid for update', [
    challengeId,
  ]);
  const result = await client.query<CaptchaChallengeRow>(
    `select c.*, v.status::text as case_status, v.case_kind::text as case_kind,
    v.server_id as case_server_id, v.user_id as case_user_id, coalesce(s.settings, '{}'::jsonb) as server_settings
    from captcha_challenges c join verification_events v on v.id = c.verification_event_id
    join servers s on s.guild_id = c.server_id where c.id = $1::uuid`,
    [challengeId]
  );
  const row = result.rows[0];
  return row &&
    row.server_id === binding.server_id &&
    row.verification_event_id === binding.verification_event_id &&
    row.case_server_id === row.server_id &&
    row.case_user_id === row.user_id
    ? row
    : null;
}
const completionBindingMatches = (
  context: ActionContext,
  input: CaptchaCompletionInput,
  challenge: CaptchaChallengeRow,
  attempt: CaptchaAttemptRow
): boolean => {
  return (
    context.actor.kind === 'user' &&
    context.actor.userId === challenge.user_id &&
    attempt.discord_user_id === context.actor.userId &&
    attempt.captcha_challenge_id === challenge.id &&
    input.provider === challenge.provider &&
    context.guildId === challenge.server_id &&
    input.challengeId === challenge.id &&
    input.generation === challenge.generation &&
    input.generation === attempt.generation
  );
};

const completionIsStale = (challenge: CaptchaChallengeRow, attempt: CaptchaAttemptRow): boolean => {
  return (
    challenge.status !== 'pending' ||
    challenge.case_status !== 'pending' ||
    challenge.case_kind !== 'standard' ||
    !currentMethodMatches(challenge) ||
    attempt.generation !== challenge.generation ||
    challenge.expires_at.getTime() <= Date.now()
  );
};

const submissionLimitReached = (challenge: CaptchaChallengeRow): boolean => {
  return challenge.submission_count >= readCaptchaMaxSubmissions(challenge.server_settings);
};

async function currentImageIssuanceMatches(
  client: DelegationQueryClient,
  challenge: CaptchaChallengeRow,
  input: CaptchaCompletionInput
): Promise<boolean> {
  if (input.provider !== 'discord_image') return true;
  const proof = input.imageIssuance;
  if (
    !proof ||
    !/^[a-f0-9]{64}$/.test(proof.keyVersion) ||
    !/^[a-f0-9]{64}$/.test(proof.answerDigest)
  )
    return false;
  // Verification happens outside the transaction. Lock and recheck that exact
  // issuance before accepting either a pass or an invalid-answer charge.
  const material = await client.query<{ generation: number }>(
    `select generation from captcha_challenge_images
             where captcha_challenge_id = $1::uuid and generation = $2
               and key_version = $3 and answer_digest = decode($4, 'hex')
             for update`,
    [challenge.id, challenge.generation, proof.keyVersion, proof.answerDigest]
  );
  return !!material.rows[0];
}

export interface CaptchaCompletionStore {
  beginAttempt(
    context: ActionContext,
    input: CaptchaBoundAttemptInput
  ): Promise<CaptchaAttemptStart>;
  completeAttempt(
    context: ActionContext,
    input: CaptchaCompletionInput
  ): Promise<CaptchaAttemptCompletion>;
  recordIdentityMismatch(context: ActionContext, input: CaptchaBoundAttemptInput): Promise<void>;
  requeuePassEffect(context: ActionContext, input: CaptchaPassReference): Promise<void>;
}
export function createCaptchaCompletionStore(database: DelegationDatabase): CaptchaCompletionStore {
  async function requeuePassEffectTransaction(
    context: ActionContext,
    input: CaptchaPassReference
  ): Promise<void> {
    return database.transaction(async (client) => {
      const current = await selectChallenge(client, input.challengeId);
      if (
        context.actor.kind === 'system' &&
        context.actor.purpose === 'captcha_pass' &&
        current?.status === 'passed' &&
        currentMethodMatches(current) &&
        current.id === input.challengeId &&
        current.server_id === context.guildId &&
        current.user_id === input.targetUserId &&
        current.verification_event_id === input.caseId &&
        current.generation === input.generation &&
        current.case_revision_at_issue === input.expectedCaseRevision
      )
        await insertModerationActionRequestWithReceipt(
          client,
          encodeCaptchaEffect(context.guildId, {
            kind: 'apply_captcha_pass',
            caseId: input.caseId,
            targetUserId: input.targetUserId,
            challengeId: input.challengeId,
            generation: input.generation,
            expectedCaseRevision: input.expectedCaseRevision,
          })
        );
    });
  }

  async function insertAttempt(
    client: DelegationQueryClient,
    input: {
      readonly challenge: CaptchaChallengeRow;
      readonly discordUserId: string;
      readonly idempotencyKey: string;
      readonly validationState: 'started' | 'identity_mismatch';
    }
  ): Promise<Pick<CaptchaAttemptRow, 'id' | 'validation_state'> | null> {
    const inserted = await client.query<Pick<CaptchaAttemptRow, 'id' | 'validation_state'>>(
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
    client: DelegationQueryClient,
    idempotencyKey: string
  ): Promise<CaptchaAttemptRow | null> {
    const result = await client.query<CaptchaAttemptRow>(
      `select id::text, captcha_challenge_id::text, generation, discord_user_id, validation_state::text as validation_state
     from captcha_challenge_attempts
     where idempotency_key = $1`,
      [idempotencyKey]
    );
    return result.rows[0] ?? null;
  }

  async function readAttemptLimits(
    client: DelegationQueryClient,
    challenge: CaptchaChallengeRow,
    discordUserId: string
  ): Promise<{ generationCount: number; recentServiceCount: number; recentUserCount: number }> {
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
      [
        challenge.id,
        challenge.generation,
        new Date(Date.now() - CAPTCHA_ATTEMPT_ABANDONED_AFTER_MS),
      ]
    );
    const result = await client.query<{
      generation_count: string;
      recent_service_count: string;
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
        ) as recent_user_count,
        (
          select count(*)::text
          from captcha_challenge_attempts
          where created_at >= $4::timestamptz
            and validation_state <> 'identity_mismatch'::captcha_attempt_validation_state
        ) as recent_service_count`,
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
      recentServiceCount: Number(counts?.recent_service_count ?? 0),
      recentUserCount: Number(counts?.recent_user_count ?? 0),
    };
  }

  async function lockCaptchaAttemptUser(
    client: DelegationQueryClient,
    discordUserId: string
  ): Promise<void> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))::text', [
      discordUserId,
    ]);
  }

  async function lockCaptchaProviderBudget(client: DelegationQueryClient): Promise<void> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))::text', [
      'drasil:captcha:provider-budget',
    ]);
  }

  async function failExhaustedGeneration(
    client: DelegationQueryClient,
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
    await insertModerationActionRequestWithReceipt(
      client,
      encodeCaptchaEffect(challenge.server_id, {
        kind: 'notify_captcha_attention',
        caseId: challenge.verification_event_id,
        targetUserId: challenge.user_id,
        challengeId: challenge.id,
        generation: challenge.generation,
        reason: 'submission_limit',
      })
    );
  }

  async function recordIdentityMismatchTransaction(
    context: ActionContext,
    input: CaptchaBoundAttemptInput
  ): Promise<void> {
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(input.idempotencyKey)) return;
    return database.transaction(async (client) => {
      const challenge = await selectChallenge(client, input.challengeId);
      if (
        challenge &&
        challenge.provider === input.provider &&
        challenge.id === input.challengeId &&
        challenge.generation === input.generation &&
        challenge.server_id === context.guildId &&
        context.actor.kind === 'user' &&
        actorId(context) !== challenge.user_id &&
        toPublicChallenge(challenge).status === 'pending'
      ) {
        await lockCaptchaAttemptUser(client, actorId(context));
        const limits = await readAttemptLimits(client, challenge, actorId(context));
        if (toPublicChallenge(challenge).status !== 'pending') return;
        if (
          limits.recentUserCount < CAPTCHA_ATTEMPT_RATE_LIMIT &&
          limits.generationCount < CAPTCHA_CHALLENGE_ATTEMPT_LIMIT
        ) {
          const inserted = await insertAttempt(client, {
            challenge,
            discordUserId: actorId(context),
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
    });
  }

  async function beginAttemptTransaction(
    context: ActionContext,
    input: CaptchaBoundAttemptInput
  ): Promise<CaptchaAttemptStart> {
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(input.idempotencyKey)) return { state: 'unavailable' };
    return database.transaction(async (client) => {
      const challenge = await selectChallenge(client, input.challengeId);
      if (!challenge) {
        return { state: 'unavailable' };
      }
      const publicChallenge = toPublicChallenge(challenge);
      if (
        context.actor.kind !== 'user' ||
        context.guildId !== challenge.server_id ||
        input.provider !== challenge.provider ||
        input.challengeId !== challenge.id ||
        input.generation !== challenge.generation ||
        actorId(context) !== challenge.user_id
      ) {
        return { state: 'identity_mismatch', challenge: publicChallenge };
      }
      if (publicChallenge.status !== 'pending') {
        return { state: 'stale', challenge: publicChallenge };
      }
      const existing = await findAttemptByIdempotencyKey(client, input.idempotencyKey);
      if (existing) {
        if (
          existing.captcha_challenge_id !== challenge.id ||
          existing.generation !== input.generation ||
          existing.discord_user_id !== actorId(context)
        )
          return { state: 'unavailable' };
        return {
          state: 'duplicate',
          attemptId: existing.id,
          previousState: existing.validation_state,
          challenge: publicChallenge,
        };
      }
      await lockCaptchaAttemptUser(client, actorId(context));
      await lockCaptchaProviderBudget(client);
      const limits = await readAttemptLimits(client, challenge, actorId(context));
      const currentChallenge = toPublicChallenge(challenge);
      if (currentChallenge.status !== 'pending')
        return { state: 'stale', challenge: currentChallenge };
      if (
        submissionLimitReached(challenge) ||
        limits.generationCount >= CAPTCHA_CHALLENGE_ATTEMPT_LIMIT
      ) {
        await failExhaustedGeneration(client, challenge);
        return { state: 'stale', challenge: { ...publicChallenge, status: 'failed' } };
      }
      if (limits.recentUserCount >= CAPTCHA_ATTEMPT_RATE_LIMIT) {
        return { state: 'rate_limited', challenge: publicChallenge };
      }
      if (limits.recentServiceCount >= CAPTCHA_SERVICE_ATTEMPT_RATE_LIMIT) {
        return { state: 'rate_limited', challenge: publicChallenge };
      }
      const attempt = await insertAttempt(client, {
        challenge,
        discordUserId: actorId(context),
        idempotencyKey: input.idempotencyKey,
        validationState: 'started',
      });
      if (!attempt) {
        const duplicate = await findAttemptByIdempotencyKey(client, input.idempotencyKey);
        if (
          !duplicate ||
          duplicate.captcha_challenge_id !== challenge.id ||
          duplicate.generation !== input.generation ||
          duplicate.discord_user_id !== actorId(context)
        )
          return { state: 'unavailable' };
        return {
          state: 'duplicate',
          attemptId: duplicate.id,
          previousState: duplicate.validation_state,
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
        return { state: 'stale', challenge: { ...publicChallenge, status: 'failed' } };
      }
      return { state: 'ready', attemptId: attempt.id, challenge: publicChallenge };
    });
  }

  async function completeAttemptTransaction(
    context: ActionContext,
    input: CaptchaCompletionInput
  ): Promise<CaptchaAttemptCompletion> {
    return database.transaction(async (client) => {
      const row = await selectChallenge(client, input.challengeId);
      if (!row) return 'stale';
      const result = await client.query<CaptchaAttemptRow>(
        'select id::text, captcha_challenge_id::text, generation, discord_user_id, validation_state::text as validation_state from captcha_challenge_attempts where id = $1::uuid for update',
        [input.attemptId]
      );
      const attempt = result.rows[0];
      if (!attempt || !completionBindingMatches(context, input, row, attempt)) {
        return 'stale';
      }
      if (attempt.validation_state !== 'started') {
        return stateForExistingAttempt(attempt.validation_state);
      }
      const nativeIssuanceMatches = await currentImageIssuanceMatches(client, row, input);
      const stale = !nativeIssuanceMatches || completionIsStale(row, attempt);
      if (stale || submissionLimitReached(row)) {
        await client.query(
          `update captcha_challenge_attempts
         set validation_state = 'stale', validated_at = now()
         where id = $1::uuid and validation_state = 'started'`,
          [input.attemptId]
        );
        if (stale) return 'stale';
        await failExhaustedGeneration(client, row);
        return 'failed';
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
          await insertModerationActionRequestWithReceipt(
            client,
            encodeCaptchaEffect(row.server_id, {
              kind: 'notify_captcha_attention',
              caseId: row.verification_event_id,
              targetUserId: row.user_id,
              challengeId: row.id,
              generation: row.generation,
              reason: 'submission_limit',
            })
          );
        }
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
        return 'stale';
      }
      await insertModerationActionRequestWithReceipt(
        client,
        encodeCaptchaEffect(row.server_id, {
          kind: 'apply_captcha_pass',
          caseId: row.verification_event_id,
          targetUserId: row.user_id,
          challengeId: row.id,
          generation: row.generation,
          expectedCaseRevision: row.case_revision_at_issue,
        })
      );
      return 'passed';
    });
  }

  return {
    beginAttempt: beginAttemptTransaction,
    completeAttempt: completeAttemptTransaction,
    recordIdentityMismatch: recordIdentityMismatchTransaction,
    requeuePassEffect: requeuePassEffectTransaction,
  };
}
