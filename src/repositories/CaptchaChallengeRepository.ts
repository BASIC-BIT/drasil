import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import {
  CaptchaChallenge,
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestOutcome,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseKind,
  ModerationActionRequestStatus,
  VerificationStatus,
} from './types';

export interface CaptchaChallengeIssueInput {
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

export interface ICaptchaChallengeRepository {
  findById(id: string): Promise<CaptchaChallenge | null>;
  findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null>;
  create(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge>;
  retry(input: CaptchaChallengeRetryInput): Promise<CaptchaChallenge>;
  recordDelivery(id: string, generation: number): Promise<boolean>;
  recordDeliveryFailure(id: string, generation: number, code: string): Promise<boolean>;
  bypass(
    id: string,
    generation: number,
    moderatorId: string,
    reason: string
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
}

@injectable()
export class CaptchaChallengeRepository implements ICaptchaChallengeRepository {
  public constructor(@inject(TYPES.PrismaClient) private readonly prisma: PrismaClient) {}

  public async findById(id: string): Promise<CaptchaChallenge | null> {
    return (await this.prisma.captcha_challenges.findUnique({
      where: { id },
    })) as CaptchaChallenge | null;
  }

  public async findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null> {
    return (await this.prisma.captcha_challenges.findUnique({
      where: { verification_event_id: verificationEventId },
    })) as CaptchaChallenge | null;
  }

  public async create(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const pendingCase = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT verification.id::text
          FROM verification_events AS verification
          JOIN servers AS server ON server.guild_id = verification.server_id
          WHERE verification.id = ${input.verificationEventId}::uuid
            AND verification.server_id = ${input.serverId}
            AND verification.user_id = ${input.userId}
            AND verification.status = ${VerificationStatus.PENDING}::verification_status
            AND verification.case_kind = ${CaseKind.STANDARD}::case_kind
            AND verification.case_revision = ${input.caseRevision}
            AND coalesce(server.settings->>'captcha_mode', 'off') <> 'off'
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
            pass_effect: input.passEffect,
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
      const pendingCase = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT verification.id::text
        FROM verification_events AS verification
        JOIN servers AS server ON server.guild_id = verification.server_id
        WHERE verification.id = ${input.verificationEventId}::uuid
          AND verification.server_id = ${input.serverId}
          AND verification.user_id = ${input.userId}
          AND verification.status = ${VerificationStatus.PENDING}::verification_status
          AND verification.case_kind = ${CaseKind.STANDARD}::case_kind
          AND verification.case_revision = ${input.caseRevision}
          AND coalesce(server.settings->>'captcha_mode', 'off') <> 'off'
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
      const pendingDeliveryFailure =
        existing.status === CaptchaChallengeStatus.PENDING && Boolean(existing.delivery_error_code);
      const retryableStatus =
        existing.status === CaptchaChallengeStatus.FAILED ||
        existing.status === CaptchaChallengeStatus.EXPIRED ||
        existing.status === CaptchaChallengeStatus.BYPASSED ||
        existing.status === CaptchaChallengeStatus.CANCELLED;
      if (!pendingDeliveryFailure && !retryableStatus) {
        throw new Error('This CAPTCHA challenge is not eligible for retry.');
      }
      const activePresentationRequestKey = pendingDeliveryFailure
        ? `captcha:attention:${existing.id}:${existing.generation}:delivery-failed`
        : existing.status === CaptchaChallengeStatus.FAILED
          ? `captcha:attention:${existing.id}:${existing.generation}:submission-limit`
          : existing.status === CaptchaChallengeStatus.EXPIRED
            ? `captcha:attention:${existing.id}:${existing.generation}:expired`
            : existing.status === CaptchaChallengeStatus.CANCELLED
              ? `captcha:presentation:${existing.id}:${existing.generation}:cancelled`
              : null;
      if (activePresentationRequestKey) {
        const activeAttention = await transaction.$queryRaw<Array<{ id: string }>>`
          select request.id::text
          from moderation_action_requests as request
          where request.idempotency_key = ${activePresentationRequestKey}
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

      const generationOutcome = pendingDeliveryFailure
        ? CaptchaChallengeRequestOutcome.DELIVERY_FAILED
        : existing.status === CaptchaChallengeStatus.FAILED
          ? CaptchaChallengeRequestOutcome.FAILED
          : existing.status === CaptchaChallengeStatus.EXPIRED
            ? CaptchaChallengeRequestOutcome.EXPIRED
            : existing.status === CaptchaChallengeStatus.BYPASSED
              ? CaptchaChallengeRequestOutcome.BYPASSED
              : CaptchaChallengeRequestOutcome.CANCELLED;
      const outcomeAt =
        generationOutcome === CaptchaChallengeRequestOutcome.BYPASSED
          ? (existing.bypassed_at ?? existing.updated_at)
          : generationOutcome === CaptchaChallengeRequestOutcome.CANCELLED
            ? (existing.cancelled_at ?? existing.updated_at)
            : existing.updated_at;
      const archivedGeneration = await transaction.captcha_challenge_requests.updateMany({
        where: {
          captcha_challenge_id: existing.id,
          generation: existing.generation,
          outcome: null,
        },
        data: {
          outcome: generationOutcome,
          outcome_at: outcomeAt,
          delivery_error_code: pendingDeliveryFailure ? existing.delivery_error_code : null,
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
          ...(pendingDeliveryFailure ? { delivery_error_code: existing.delivery_error_code } : {}),
        },
        data: {
          status: CaptchaChallengeStatus.PENDING,
          request_source: input.requestSource,
          pass_effect: input.passEffect,
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
      return retried;
    })) as CaptchaChallenge;
  }

  public async recordDelivery(id: string, generation: number): Promise<boolean> {
    const result = await this.prisma.captcha_challenges.updateMany({
      where: { id, generation, status: CaptchaChallengeStatus.PENDING },
      data: { delivered_at: new Date(), delivery_error_code: null, updated_at: new Date() },
    });
    return result.count === 1;
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
    reason: string
  ): Promise<CaptchaChallenge | null> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new Error('A reason is required to continue without the browser check.');
    }
    const boundedReason = normalizedReason.slice(0, 1000);
    const bypassedAt = new Date();
    return (await this.prisma.$transaction(async (transaction) => {
      const eligible = await transaction.$queryRaw<Array<{ id: string }>>`
        select challenge.id::text
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
          and coalesce(server.settings->>'captcha_mode', 'off') <> 'off'
        for update of verification, challenge, server
      `;
      if (!eligible[0]) {
        return null;
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
}
