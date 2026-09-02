import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import {
  CaptchaChallenge,
  CaptchaChallengeGenerationHistory,
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestOutcome,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseKind,
  ModerationActionRequestStatus,
  VerificationStatus,
} from './types';

export interface CaptchaChallengeIssueInput {
  actionRequestId?: string;
  verificationEventId: string;
  serverId: string;
  userId: string;
  requestSource: CaptchaChallengeRequestSource;
  passEffect: CaptchaChallengePassEffect;
  caseRevision: number;
  tokenHash: string;
  expiresAt: Date;
  requestedBy?: string | null;
}

export interface CaptchaChallengeRetryInput extends CaptchaChallengeIssueInput {
  expectedChallengeId: string;
  expectedGeneration: number;
}

interface CaptchaChallengeRetryState {
  activePresentationRequestKey: string | null;
  deliveryErrorCode: string | null;
  outcome: CaptchaChallengeRequestOutcome;
  outcomeAt: Date;
  pendingDeliveryFailure: boolean;
}

interface CaptchaChallengeRetryRecord {
  bypassed_at: Date | null;
  cancelled_at: Date | null;
  delivery_error_code: string | null;
  generation: number;
  id: string;
  status: string;
  updated_at: Date;
}

interface CaptchaChallengeRequestHistoryRecord {
  generation: number;
  request_source: CaptchaChallengeRequestSource;
  pass_effect: CaptchaChallengePassEffect;
  case_revision_at_issue: number;
  requested_by: string | null;
  requested_at: Date;
  presented_at: Date | null;
  outcome: CaptchaChallengeRequestOutcome | null;
  outcome_at: Date | null;
  delivery_error_code: string | null;
}

interface CaptchaChallengeBypassHistoryRecord {
  generation: number;
  moderator_id: string;
  reason: string;
  bypassed_at: Date;
}

interface CaptchaChallengeWithHistoryRecord extends CaptchaChallenge {
  requests: CaptchaChallengeRequestHistoryRecord[];
  bypasses: CaptchaChallengeBypassHistoryRecord[];
}

function getCaptchaChallengeRetryState(
  challenge: CaptchaChallengeRetryRecord
): CaptchaChallengeRetryState | null {
  const keyPrefix = `${challenge.id}:${challenge.generation}`;
  if (challenge.status === CaptchaChallengeStatus.PENDING) {
    if (!challenge.delivery_error_code) {
      return null;
    }
    return {
      activePresentationRequestKey: `captcha:attention:${keyPrefix}:delivery-failed`,
      deliveryErrorCode: challenge.delivery_error_code,
      outcome: CaptchaChallengeRequestOutcome.DELIVERY_FAILED,
      outcomeAt: challenge.updated_at,
      pendingDeliveryFailure: true,
    };
  }
  switch (challenge.status) {
    case CaptchaChallengeStatus.FAILED:
      return {
        activePresentationRequestKey: `captcha:attention:${keyPrefix}:submission-limit`,
        deliveryErrorCode: null,
        outcome: CaptchaChallengeRequestOutcome.FAILED,
        outcomeAt: challenge.updated_at,
        pendingDeliveryFailure: false,
      };
    case CaptchaChallengeStatus.EXPIRED:
      return {
        activePresentationRequestKey: `captcha:attention:${keyPrefix}:expired`,
        deliveryErrorCode: null,
        outcome: CaptchaChallengeRequestOutcome.EXPIRED,
        outcomeAt: challenge.updated_at,
        pendingDeliveryFailure: false,
      };
    case CaptchaChallengeStatus.BYPASSED:
      return {
        activePresentationRequestKey: `captcha:presentation:${keyPrefix}:bypassed`,
        deliveryErrorCode: null,
        outcome: CaptchaChallengeRequestOutcome.BYPASSED,
        outcomeAt: challenge.bypassed_at ?? challenge.updated_at,
        pendingDeliveryFailure: false,
      };
    case CaptchaChallengeStatus.CANCELLED:
      return {
        activePresentationRequestKey: `captcha:presentation:${keyPrefix}:cancelled`,
        deliveryErrorCode: null,
        outcome: CaptchaChallengeRequestOutcome.CANCELLED,
        outcomeAt: challenge.cancelled_at ?? challenge.updated_at,
        pendingDeliveryFailure: false,
      };
    default:
      return null;
  }
}

export interface ICaptchaChallengeRepository {
  findById(id: string): Promise<CaptchaChallenge | null>;
  findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null>;
  create(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge>;
  retry(input: CaptchaChallengeRetryInput): Promise<CaptchaChallenge>;
  recordDelivery(id: string, generation: number): Promise<boolean>;
  recordPresentation(id: string, generation: number): Promise<boolean>;
  recordPresentationAttempt(id: string, generation: number): Promise<boolean>;
  recordDeliveryFailure(id: string, generation: number, code: string): Promise<boolean>;
  bypass(
    id: string,
    generation: number,
    moderatorId: string,
    reason: string,
    actionRequestId?: string
  ): Promise<CaptchaChallenge | null>;
  cancelPendingForCase(verificationEventId: string): Promise<boolean>;
  cancelPendingForDisabledServers(limit: number): Promise<CaptchaChallenge[]>;
  cancelPendingForTerminalCases(limit: number): Promise<CaptchaChallenge[]>;
  markStaleUndelivered(staleBefore: Date, limit: number): Promise<CaptchaChallenge[]>;
  expirePending(now: Date, limit: number): Promise<CaptchaChallenge[]>;
  findDeliveryFailuresNeedingAttention(limit: number): Promise<CaptchaChallenge[]>;
  findFailedNeedingAttention(limit: number): Promise<CaptchaChallenge[]>;
  findExpiredNeedingAttention(limit: number): Promise<CaptchaChallenge[]>;
  findCancelledNeedingPresentation(limit: number): Promise<CaptchaChallenge[]>;
  findBypassedNeedingPresentation(limit: number): Promise<CaptchaChallenge[]>;
  findDeliveredNeedingPresentation(limit: number): Promise<CaptchaChallenge[]>;
  findPassedNeedingApplication(limit: number): Promise<CaptchaChallenge[]>;
}

@injectable()
export class CaptchaChallengeRepository implements ICaptchaChallengeRepository {
  public constructor(@inject(TYPES.PrismaClient) private readonly prisma: PrismaClient) {}

  public async findById(id: string): Promise<CaptchaChallenge | null> {
    const record = await this.prisma.captcha_challenges.findUnique({
      where: { id },
      include: { requests: { orderBy: { generation: 'asc' } }, bypasses: true },
    });
    return record
      ? this.withGenerationHistory(record as unknown as CaptchaChallengeWithHistoryRecord)
      : null;
  }

  public async findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null> {
    const record = await this.prisma.captcha_challenges.findUnique({
      where: { verification_event_id: verificationEventId },
      include: { requests: { orderBy: { generation: 'asc' } }, bypasses: true },
    });
    return record
      ? this.withGenerationHistory(record as unknown as CaptchaChallengeWithHistoryRecord)
      : null;
  }

  public async create(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const pendingCase = await transaction.$queryRaw<
          Array<{ id: string; pass_effect: CaptchaChallengePassEffect }>
        >`
          SELECT verification.id::text,
            case
              when ${input.requestSource}::captcha_challenge_request_source = ${CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN}::captcha_challenge_request_source
                and coalesce(server.settings->>'captcha_pass_action', 'evidence_only') = 'verify_join_only'
              then ${CaptchaChallengePassEffect.VERIFY_JOIN_ONLY}::captcha_challenge_pass_effect
              else ${CaptchaChallengePassEffect.EVIDENCE_ONLY}::captcha_challenge_pass_effect
            end as pass_effect
          FROM verification_events AS verification
          JOIN servers AS server ON server.guild_id = verification.server_id
          WHERE verification.id = ${input.verificationEventId}::uuid
            AND verification.server_id = ${input.serverId}
            AND verification.user_id = ${input.userId}
            AND verification.status = ${VerificationStatus.PENDING}::verification_status
            AND verification.case_kind = ${CaseKind.STANDARD}::case_kind
            AND verification.case_revision = ${input.caseRevision}
            AND (
              (
                ${input.requestSource}::captcha_challenge_request_source = ${CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN}::captcha_challenge_request_source
                AND coalesce(server.settings->>'captcha_mode', 'off') = 'suspicious_join'
              )
              OR (
                ${input.requestSource}::captcha_challenge_request_source = ${CaptchaChallengeRequestSource.MODERATOR}::captcha_challenge_request_source
                AND coalesce(server.settings->>'captcha_mode', 'off') in ('manual', 'suspicious_join')
              )
            )
          FOR UPDATE OF verification, server
        `;
        if (!pendingCase[0]) {
          throw new Error('The case changed before the security check could be created.');
        }
        const challenge = await transaction.captcha_challenges.create({
          data: {
            verification_event_id: input.verificationEventId,
            server_id: input.serverId,
            user_id: input.userId,
            request_source: input.requestSource,
            pass_effect: pendingCase[0].pass_effect,
            case_revision_at_issue: input.caseRevision,
            link_token_hash: input.tokenHash,
            expires_at: input.expiresAt,
            requested_by: input.requestedBy ?? null,
          },
        });
        await transaction.captcha_challenge_requests.create({
          data: {
            captcha_challenge_id: challenge.id,
            generation: challenge.generation,
            request_source: challenge.request_source,
            pass_effect: challenge.pass_effect,
            case_revision_at_issue: challenge.case_revision_at_issue,
            requested_by: challenge.requested_by,
            requested_at: challenge.requested_at,
          },
        });
        await this.persistMutationReceipt(transaction, input.actionRequestId, {
          challenge_id: challenge.id,
          generation: challenge.generation,
          operation: 'request',
        });
        return challenge;
      })) as CaptchaChallenge;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingForCase = await this.findByCaseId(input.verificationEventId);
        if (existingForCase) {
          throw new Error('This case already has a CAPTCHA challenge.');
        }
        const existingForToken = await this.prisma.captcha_challenges.findUnique({
          where: { link_token_hash: input.tokenHash },
        });
        if (existingForToken) {
          throw new Error('Could not create a unique CAPTCHA link. Try issuing the check again.');
        }
      }
      throw error;
    }
  }

  public async retry(input: CaptchaChallengeRetryInput): Promise<CaptchaChallenge> {
    return (await this.prisma.$transaction(async (transaction) => {
      const pendingCase = await transaction.$queryRaw<
        Array<{ id: string; pass_effect: CaptchaChallengePassEffect }>
      >`
        SELECT verification.id::text,
          case
            when ${input.requestSource}::captcha_challenge_request_source = ${CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN}::captcha_challenge_request_source
              and coalesce(server.settings->>'captcha_pass_action', 'evidence_only') = 'verify_join_only'
            then ${CaptchaChallengePassEffect.VERIFY_JOIN_ONLY}::captcha_challenge_pass_effect
            else ${CaptchaChallengePassEffect.EVIDENCE_ONLY}::captcha_challenge_pass_effect
          end as pass_effect
        FROM verification_events AS verification
        JOIN servers AS server ON server.guild_id = verification.server_id
        WHERE verification.id = ${input.verificationEventId}::uuid
          AND verification.server_id = ${input.serverId}
          AND verification.user_id = ${input.userId}
          AND verification.status = ${VerificationStatus.PENDING}::verification_status
          AND verification.case_kind = ${CaseKind.STANDARD}::case_kind
          AND verification.case_revision = ${input.caseRevision}
          AND (
            (
              ${input.requestSource}::captcha_challenge_request_source = ${CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN}::captcha_challenge_request_source
              AND coalesce(server.settings->>'captcha_mode', 'off') = 'suspicious_join'
            )
            OR (
              ${input.requestSource}::captcha_challenge_request_source = ${CaptchaChallengeRequestSource.MODERATOR}::captcha_challenge_request_source
              AND coalesce(server.settings->>'captcha_mode', 'off') in ('manual', 'suspicious_join')
            )
          )
        FOR UPDATE OF verification, server
      `;
      if (!pendingCase[0]) {
        throw new Error('The case changed before the security check could be retried.');
      }
      const existing = await transaction.captcha_challenges.findUnique({
        where: { id: input.expectedChallengeId },
      });
      if (
        !existing ||
        existing.verification_event_id !== input.verificationEventId ||
        existing.server_id !== input.serverId ||
        existing.user_id !== input.userId ||
        existing.generation !== input.expectedGeneration
      ) {
        throw new Error('The security check changed before it could be retried.');
      }
      if (existing.status === CaptchaChallengeStatus.PASSED) {
        throw new Error('This case has already passed its security check.');
      }
      const retryState = getCaptchaChallengeRetryState(existing);
      if (!retryState) {
        throw new Error('This CAPTCHA challenge is not eligible for retry.');
      }
      if (retryState.activePresentationRequestKey) {
        const activeAttention = await transaction.$queryRaw<Array<{ id: string }>>`
          select request.id::text
          from moderation_action_requests as request
          where request.idempotency_key = ${retryState.activePresentationRequestKey}
            and request.status in (
              ${ModerationActionRequestStatus.QUEUED}::moderation_action_request_status,
              ${ModerationActionRequestStatus.PROCESSING}::moderation_action_request_status
            )
          for update
        `;
        if (activeAttention[0]) {
          throw new Error(
            'The current security-check status is still being delivered. Wait a moment and try again.'
          );
        }
      }

      const archivedGeneration = await transaction.captcha_challenge_requests.updateMany({
        where: {
          captcha_challenge_id: existing.id,
          generation: existing.generation,
          outcome: null,
        },
        data: {
          outcome: retryState.outcome,
          outcome_at: retryState.outcomeAt,
          delivery_error_code: retryState.deliveryErrorCode,
        },
      });
      if (archivedGeneration.count !== 1) {
        throw new Error('The CAPTCHA challenge history changed while retrying.');
      }

      const updated = await transaction.captcha_challenges.updateMany({
        where: {
          id: existing.id,
          generation: existing.generation,
          status: existing.status,
          ...(retryState.pendingDeliveryFailure
            ? { delivery_error_code: retryState.deliveryErrorCode }
            : {}),
        },
        data: {
          status: CaptchaChallengeStatus.PENDING,
          request_source: input.requestSource,
          pass_effect: pendingCase[0].pass_effect,
          generation: { increment: 1 },
          case_revision_at_issue: input.caseRevision,
          link_token_hash: input.tokenHash,
          expires_at: input.expiresAt,
          submission_count: 0,
          requested_by: input.requestedBy ?? null,
          requested_at: new Date(),
          delivered_at: null,
          delivery_error_code: null,
          bypassed_by: null,
          bypassed_at: null,
          bypass_reason: null,
          cancelled_at: null,
          updated_at: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new Error('The CAPTCHA challenge changed while retrying.');
      }
      const retried = await transaction.captcha_challenges.findUniqueOrThrow({
        where: { id: existing.id },
      });
      await transaction.captcha_challenge_requests.create({
        data: {
          captcha_challenge_id: retried.id,
          generation: retried.generation,
          request_source: retried.request_source,
          pass_effect: retried.pass_effect,
          case_revision_at_issue: retried.case_revision_at_issue,
          requested_by: retried.requested_by,
          requested_at: retried.requested_at,
        },
      });
      await this.persistMutationReceipt(transaction, input.actionRequestId, {
        challenge_id: retried.id,
        generation: retried.generation,
        operation: 'retry',
      });
      return retried;
    })) as CaptchaChallenge;
  }

  public async recordDelivery(id: string, generation: number): Promise<boolean> {
    const delivered = await this.prisma.$queryRaw<Array<{ id: string }>>`
      update captcha_challenges as challenge
      set delivered_at = now(),
          delivery_error_code = null,
          updated_at = now()
      from verification_events as verification,
           servers as server
      where challenge.id = ${id}::uuid
        and challenge.generation = ${generation}
        and challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
        and verification.id = challenge.verification_event_id
        and verification.status = ${VerificationStatus.PENDING}::verification_status
        and verification.case_kind = ${CaseKind.STANDARD}::case_kind
        and server.guild_id = challenge.server_id
        and coalesce(server.settings->>'captcha_mode', 'off') in ('manual', 'suspicious_join')
      returning challenge.id::text
    `;
    return delivered.length === 1;
  }

  public async recordPresentation(id: string, generation: number): Promise<boolean> {
    const result = await this.prisma.captcha_challenge_requests.updateMany({
      where: { captcha_challenge_id: id, generation, presented_at: null },
      data: { presented_at: new Date() },
    });
    return result.count === 1;
  }

  public async recordPresentationAttempt(id: string, generation: number): Promise<boolean> {
    const touched = await this.prisma.$queryRaw<Array<{ id: string }>>`
      update captcha_challenges as challenge
      set updated_at = now()
      where challenge.id = ${id}::uuid
        and challenge.generation = ${generation}
        and challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
        and challenge.delivered_at is not null
        and challenge.delivery_error_code is null
        and exists (
          select 1
          from captcha_challenge_requests as request
          where request.captcha_challenge_id = challenge.id
            and request.generation = challenge.generation
            and request.presented_at is null
        )
        and exists (
          select 1
          from verification_events as verification
          where verification.id = challenge.verification_event_id
            and verification.status = ${VerificationStatus.PENDING}::verification_status
        )
      returning challenge.id::text
    `;
    return touched.length === 1;
  }

  public async recordDeliveryFailure(
    id: string,
    generation: number,
    code: string
  ): Promise<boolean> {
    const result = await this.prisma.captcha_challenges.updateMany({
      where: { id, generation, status: CaptchaChallengeStatus.PENDING },
      data: {
        delivered_at: null,
        delivery_error_code: code.slice(0, 100),
        updated_at: new Date(),
      },
    });
    return result.count === 1;
  }

  public async bypass(
    id: string,
    generation: number,
    moderatorId: string,
    reason: string,
    actionRequestId?: string
  ): Promise<CaptchaChallenge | null> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new Error('A reason is required to continue without the browser check.');
    }
    const boundedReason = normalizedReason.slice(0, 1000);
    const bypassedAt = new Date();
    return (await this.prisma.$transaction(async (transaction) => {
      const eligible = await transaction.$queryRaw<
        Array<{
          delivery_error_code: string | null;
          id: string;
          status: CaptchaChallengeStatus;
        }>
      >`
        select challenge.id::text, challenge.status, challenge.delivery_error_code
        from captcha_challenges as challenge
        join verification_events as verification
          on verification.id = challenge.verification_event_id
        join servers as server
          on server.guild_id = challenge.server_id
        where challenge.id = ${id}::uuid
          and challenge.generation = ${generation}
          and challenge.status in (
            ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status,
            ${CaptchaChallengeStatus.FAILED}::captcha_challenge_status,
            ${CaptchaChallengeStatus.EXPIRED}::captcha_challenge_status
          )
          and verification.status = ${VerificationStatus.PENDING}::verification_status
          and verification.case_kind = ${CaseKind.STANDARD}::case_kind
          and coalesce(server.settings->>'captcha_mode', 'off') <> 'off'
        for update of verification, challenge, server
      `;
      if (!eligible[0]) {
        return null;
      }
      const attentionReason =
        eligible[0].status === CaptchaChallengeStatus.FAILED
          ? 'submission-limit'
          : eligible[0].status === CaptchaChallengeStatus.EXPIRED
            ? 'expired'
            : eligible[0].delivery_error_code
              ? 'delivery-failed'
              : null;
      if (attentionReason) {
        const activeAttention = await transaction.$queryRaw<Array<{ id: string }>>`
          select request.id::text
          from moderation_action_requests as request
          where request.idempotency_key = ${`captcha:attention:${id}:${generation}:${attentionReason}`}
            and request.status in (
              ${ModerationActionRequestStatus.QUEUED}::moderation_action_request_status,
              ${ModerationActionRequestStatus.PROCESSING}::moderation_action_request_status
            )
          for update
        `;
        if (activeAttention[0]) {
          return null;
        }
      }
      const result = await transaction.captcha_challenges.updateMany({
        where: {
          id,
          generation,
          status: {
            in: [
              CaptchaChallengeStatus.PENDING,
              CaptchaChallengeStatus.FAILED,
              CaptchaChallengeStatus.EXPIRED,
            ],
          },
        },
        data: {
          status: CaptchaChallengeStatus.BYPASSED,
          bypassed_by: moderatorId,
          bypassed_at: bypassedAt,
          bypass_reason: boundedReason,
          updated_at: bypassedAt,
        },
      });
      if (result.count !== 1) {
        return null;
      }
      await transaction.captcha_challenge_bypasses.create({
        data: {
          captcha_challenge_id: id,
          generation,
          moderator_id: moderatorId,
          reason: boundedReason,
          bypassed_at: bypassedAt,
        },
      });
      await this.persistMutationReceipt(transaction, actionRequestId, {
        challenge_id: id,
        generation,
        operation: 'bypass',
      });
      return await transaction.captcha_challenges.findUnique({ where: { id } });
    })) as CaptchaChallenge | null;
  }

  public async cancelPendingForCase(verificationEventId: string): Promise<boolean> {
    const result = await this.prisma.captcha_challenges.updateMany({
      where: {
        verification_event_id: verificationEventId,
        status: CaptchaChallengeStatus.PENDING,
      },
      data: {
        status: CaptchaChallengeStatus.CANCELLED,
        cancelled_at: new Date(),
        updated_at: new Date(),
      },
    });
    return result.count > 0;
  }

  public async cancelPendingForDisabledServers(limit: number): Promise<CaptchaChallenge[]> {
    return (await this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<CaptchaChallenge[]>`
        select challenge.*
        from captcha_challenges as challenge
        join servers as server on server.guild_id = challenge.server_id
        where challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
          and coalesce(server.settings->>'captcha_mode', 'off') = 'off'
        order by challenge.requested_at asc
        limit ${Math.max(1, Math.min(limit, 100))}
        for update of challenge, server skip locked
      `;
      const cancelled: CaptchaChallenge[] = [];
      for (const candidate of candidates) {
        const cancelledAt = new Date();
        const result = await transaction.captcha_challenges.updateMany({
          where: {
            id: candidate.id,
            generation: candidate.generation,
            status: CaptchaChallengeStatus.PENDING,
          },
          data: {
            status: CaptchaChallengeStatus.CANCELLED,
            cancelled_at: cancelledAt,
            updated_at: cancelledAt,
          },
        });
        if (result.count === 1) {
          cancelled.push(
            (await transaction.captcha_challenges.findUniqueOrThrow({
              where: { id: candidate.id },
            })) as CaptchaChallenge
          );
        }
      }
      return cancelled;
    })) as CaptchaChallenge[];
  }

  public async cancelPendingForTerminalCases(limit: number): Promise<CaptchaChallenge[]> {
    return (await this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<CaptchaChallenge[]>`
        select challenge.*
        from captcha_challenges as challenge
        join verification_events as verification
          on verification.id = challenge.verification_event_id
        where challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
          and (
            verification.status <> ${VerificationStatus.PENDING}::verification_status
            or verification.case_kind = ${CaseKind.COMPROMISED_ACCOUNT}::case_kind
          )
        order by challenge.updated_at asc
        limit ${Math.max(1, Math.min(limit, 100))}
        for update of verification, challenge skip locked
      `;
      const cancelled: CaptchaChallenge[] = [];
      for (const candidate of candidates) {
        const cancelledAt = new Date();
        const result = await transaction.captcha_challenges.updateMany({
          where: {
            id: candidate.id,
            generation: candidate.generation,
            status: CaptchaChallengeStatus.PENDING,
          },
          data: {
            status: CaptchaChallengeStatus.CANCELLED,
            cancelled_at: cancelledAt,
            updated_at: cancelledAt,
          },
        });
        if (result.count === 1) {
          cancelled.push(
            (await transaction.captcha_challenges.findUniqueOrThrow({
              where: { id: candidate.id },
            })) as CaptchaChallenge
          );
        }
      }
      return cancelled;
    })) as CaptchaChallenge[];
  }

  public async expirePending(now: Date, limit: number): Promise<CaptchaChallenge[]> {
    return (await this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<CaptchaChallenge[]>`
        select challenge.*
        from captcha_challenges as challenge
        join verification_events as verification
          on verification.id = challenge.verification_event_id
        join servers as server on server.guild_id = challenge.server_id
        where challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
          and challenge.expires_at <= ${now}
          and verification.status = ${VerificationStatus.PENDING}::verification_status
          and verification.case_kind <> ${CaseKind.COMPROMISED_ACCOUNT}::case_kind
          and coalesce(server.settings->>'captcha_mode', 'off') <> 'off'
        order by challenge.expires_at asc
        limit ${Math.max(1, Math.min(limit, 100))}
        for update of challenge, verification, server skip locked
      `;
      const expired: CaptchaChallenge[] = [];
      for (const candidate of candidates) {
        const result = await transaction.captcha_challenges.updateMany({
          where: {
            id: candidate.id,
            generation: candidate.generation,
            status: CaptchaChallengeStatus.PENDING,
            expires_at: { lte: now },
          },
          data: { status: CaptchaChallengeStatus.EXPIRED, updated_at: now },
        });
        if (result.count === 1) {
          expired.push(
            (await transaction.captcha_challenges.findUniqueOrThrow({
              where: { id: candidate.id },
            })) as CaptchaChallenge
          );
        }
      }
      return expired;
    })) as CaptchaChallenge[];
  }

  public async markStaleUndelivered(staleBefore: Date, limit: number): Promise<CaptchaChallenge[]> {
    const now = new Date();
    const candidates = await this.prisma.captcha_challenges.findMany({
      where: {
        status: CaptchaChallengeStatus.PENDING,
        delivered_at: null,
        delivery_error_code: null,
        updated_at: { lte: staleBefore },
        expires_at: { gt: now },
      },
      orderBy: { updated_at: 'asc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    const interrupted: CaptchaChallenge[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.captcha_challenges.updateMany({
        where: {
          id: candidate.id,
          generation: candidate.generation,
          status: CaptchaChallengeStatus.PENDING,
          delivered_at: null,
          delivery_error_code: null,
          updated_at: candidate.updated_at,
          expires_at: { gt: now },
        },
        data: {
          delivery_error_code: 'delivery_interrupted',
          updated_at: new Date(),
        },
      });
      if (result.count === 1) {
        const refreshed = await this.findById(candidate.id);
        if (refreshed) {
          interrupted.push(refreshed);
        }
      }
    }
    return interrupted;
  }

  public async findExpiredNeedingAttention(limit: number): Promise<CaptchaChallenge[]> {
    return this.findNeedingAttention(CaptchaChallengeStatus.EXPIRED, 'expired', limit);
  }

  public async findCancelledNeedingPresentation(limit: number): Promise<CaptchaChallenge[]> {
    return await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select challenge.*
      from captcha_challenges as challenge
      where challenge.status = ${CaptchaChallengeStatus.CANCELLED}::captcha_challenge_status
        and not exists (
          select 1
          from moderation_action_requests as request
          where request.idempotency_key = concat(
            'captcha:presentation:',
            challenge.id::text,
            ':',
            challenge.generation::text,
            ':cancelled'
          )
            and request.status in (
              'queued'::moderation_action_request_status,
              'processing'::moderation_action_request_status,
              'completed'::moderation_action_request_status
            )
        )
      order by challenge.updated_at asc nulls first
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  public async findBypassedNeedingPresentation(limit: number): Promise<CaptchaChallenge[]> {
    return await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select challenge.*
      from captcha_challenges as challenge
      where challenge.status = ${CaptchaChallengeStatus.BYPASSED}::captcha_challenge_status
        and not exists (
          select 1
          from moderation_action_requests as request
          where request.idempotency_key = concat(
            'captcha:presentation:',
            challenge.id::text,
            ':',
            challenge.generation::text,
            ':bypassed'
          )
            and request.status in (
              'queued'::moderation_action_request_status,
              'processing'::moderation_action_request_status,
              'completed'::moderation_action_request_status
            )
        )
      order by challenge.updated_at asc nulls first
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  public async findDeliveredNeedingPresentation(limit: number): Promise<CaptchaChallenge[]> {
    return await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select challenge.*
      from captcha_challenges as challenge
      join captcha_challenge_requests as request
        on request.captcha_challenge_id = challenge.id
        and request.generation = challenge.generation
      join verification_events as verification
        on verification.id = challenge.verification_event_id
      where challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
        and challenge.delivered_at is not null
        and challenge.delivery_error_code is null
        and request.presented_at is null
        and verification.status = ${VerificationStatus.PENDING}::verification_status
      order by challenge.updated_at asc, challenge.id asc
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  public async findPassedNeedingApplication(limit: number): Promise<CaptchaChallenge[]> {
    return await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select challenge.*
      from captcha_challenges as challenge
      where challenge.status = ${CaptchaChallengeStatus.PASSED}::captcha_challenge_status
        and not exists (
          select 1
          from moderation_action_requests as request
          where request.idempotency_key = concat(
            'captcha:apply:',
            challenge.id::text,
            ':',
            challenge.generation::text
          )
            and request.status in (
              'queued'::moderation_action_request_status,
              'processing'::moderation_action_request_status,
              'completed'::moderation_action_request_status
            )
        )
      order by coalesce(
        (
          select max(request.updated_at)
          from moderation_action_requests as request
          where request.idempotency_key = concat(
            'captcha:apply:',
            challenge.id::text,
            ':',
            challenge.generation::text
          )
            and request.status = 'failed'::moderation_action_request_status
        ),
        challenge.updated_at
      ) asc nulls first
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  public async findFailedNeedingAttention(limit: number): Promise<CaptchaChallenge[]> {
    return this.findNeedingAttention(CaptchaChallengeStatus.FAILED, 'submission-limit', limit);
  }

  public async findDeliveryFailuresNeedingAttention(limit: number): Promise<CaptchaChallenge[]> {
    return await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select challenge.*
      from captcha_challenges as challenge
      join verification_events as verification
        on verification.id = challenge.verification_event_id
      where challenge.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
        and challenge.delivered_at is null
        and challenge.delivery_error_code is not null
        and verification.status = ${VerificationStatus.PENDING}::verification_status
        and not exists (
          select 1
          from moderation_action_requests as request
          where request.idempotency_key = concat(
            'captcha:attention:',
            challenge.id::text,
            ':',
            challenge.generation::text,
            ':delivery-failed'
          )
            and request.status in (
              'queued'::moderation_action_request_status,
              'processing'::moderation_action_request_status,
              'completed'::moderation_action_request_status
            )
        )
      order by challenge.updated_at asc nulls first
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  private async findNeedingAttention(
    status: CaptchaChallengeStatus,
    reasonKey: string,
    limit: number
  ): Promise<CaptchaChallenge[]> {
    return await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select challenge.*
      from captcha_challenges as challenge
      join verification_events as verification
        on verification.id = challenge.verification_event_id
      where challenge.status = ${status}::captcha_challenge_status
        and verification.status = 'pending'::verification_status
        and not exists (
          select 1
          from moderation_action_requests as request
          where request.idempotency_key = concat(
            'captcha:attention:',
            challenge.id::text,
            ':',
            challenge.generation::text,
            ${`:${reasonKey}`}::text
          )
            and request.status in (
              'queued'::moderation_action_request_status,
              'processing'::moderation_action_request_status,
              'completed'::moderation_action_request_status
            )
        )
      order by challenge.updated_at asc nulls first
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  private withGenerationHistory(record: CaptchaChallengeWithHistoryRecord): CaptchaChallenge {
    const bypassByGeneration = new Map(
      record.bypasses.map((bypass) => [bypass.generation, bypass] as const)
    );
    const history: CaptchaChallengeGenerationHistory[] = record.requests.map((request) => {
      const bypass = bypassByGeneration.get(request.generation);
      return {
        generation: request.generation,
        request_source: request.request_source,
        pass_effect: request.pass_effect,
        case_revision_at_issue: request.case_revision_at_issue,
        requested_by: request.requested_by,
        requested_at: request.requested_at,
        presented_at: request.presented_at,
        outcome: request.outcome,
        outcome_at: request.outcome_at,
        delivery_error_code: request.delivery_error_code,
        bypassed_by: bypass?.moderator_id ?? null,
        bypassed_at: bypass?.bypassed_at ?? null,
        bypass_reason: bypass?.reason ?? null,
      };
    });
    const challenge = { ...record };
    Reflect.deleteProperty(challenge, 'requests');
    Reflect.deleteProperty(challenge, 'bypasses');
    return { ...challenge, history };
  }

  private async persistMutationReceipt(
    transaction: Prisma.TransactionClient,
    actionRequestId: string | undefined,
    receipt: Prisma.JsonObject
  ): Promise<void> {
    if (!actionRequestId) {
      return;
    }
    const updated = await transaction.$executeRaw`
      update moderation_action_requests
      set metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        captcha_mutation_receipt: receipt,
      })}::jsonb,
          updated_at = now()
      where id = ${actionRequestId}::uuid
        and status = ${ModerationActionRequestStatus.PROCESSING}::moderation_action_request_status
    `;
    if (updated !== 1) {
      throw new Error('The security-check action changed before its mutation was recorded.');
    }
  }
}
