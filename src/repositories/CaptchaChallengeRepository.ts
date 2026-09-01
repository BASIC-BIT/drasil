import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import {
  CaptchaChallenge,
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
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

export interface ICaptchaChallengeRepository {
  findById(id: string): Promise<CaptchaChallenge | null>;
  findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null>;
  create(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge>;
  retry(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge>;
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
  expirePending(now: Date, limit: number): Promise<CaptchaChallenge[]>;
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
          SELECT id::text
          FROM verification_events
          WHERE id = ${input.verificationEventId}::uuid
            AND server_id = ${input.serverId}
            AND user_id = ${input.userId}
            AND status = ${VerificationStatus.PENDING}::verification_status
            AND case_revision = ${input.caseRevision}
          FOR UPDATE
        `;
        if (!pendingCase[0]) {
          throw new Error('The case changed before the security check could be created.');
        }
        return await transaction.captcha_challenges.create({
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

  public async retry(input: CaptchaChallengeIssueInput): Promise<CaptchaChallenge> {
    return (await this.prisma.$transaction(async (transaction) => {
      const pendingCase = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id::text
        FROM verification_events
        WHERE id = ${input.verificationEventId}::uuid
          AND server_id = ${input.serverId}
          AND user_id = ${input.userId}
          AND status = ${VerificationStatus.PENDING}::verification_status
          AND case_revision = ${input.caseRevision}
        FOR UPDATE
      `;
      if (!pendingCase[0]) {
        throw new Error('The case changed before the security check could be retried.');
      }
      const existing = await transaction.captcha_challenges.findUnique({
        where: { verification_event_id: input.verificationEventId },
      });
      if (!existing) {
        throw new Error('No CAPTCHA challenge exists for this case.');
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
      return await transaction.captcha_challenges.findUniqueOrThrow({
        where: { id: existing.id },
      });
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
    const result = await this.prisma.captcha_challenges.updateMany({
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
        bypassed_at: new Date(),
        bypass_reason: normalizedReason.slice(0, 1000),
        updated_at: new Date(),
      },
    });
    return result.count === 1 ? this.findById(id) : null;
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
    const candidates = await this.prisma.$queryRaw<CaptchaChallenge[]>`
      select c.*
      from captcha_challenges c
      join servers s on s.guild_id = c.server_id
      where c.status = ${CaptchaChallengeStatus.PENDING}::captcha_challenge_status
        and coalesce(s.settings->>'captcha_mode', 'off') = 'off'
      order by c.requested_at asc
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
    const cancelled: CaptchaChallenge[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.captcha_challenges.updateMany({
        where: {
          id: candidate.id,
          generation: candidate.generation,
          status: CaptchaChallengeStatus.PENDING,
        },
        data: {
          status: CaptchaChallengeStatus.CANCELLED,
          cancelled_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (result.count === 1) {
        const refreshed = await this.findById(candidate.id);
        if (refreshed) {
          cancelled.push(refreshed);
        }
      }
    }
    return cancelled;
  }

  public async expirePending(now: Date, limit: number): Promise<CaptchaChallenge[]> {
    const candidates = await this.prisma.captcha_challenges.findMany({
      where: {
        status: CaptchaChallengeStatus.PENDING,
        expires_at: { lte: now },
      },
      orderBy: { expires_at: 'asc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    const expired: CaptchaChallenge[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.captcha_challenges.updateMany({
        where: {
          id: candidate.id,
          generation: candidate.generation,
          status: CaptchaChallengeStatus.PENDING,
          expires_at: { lte: now },
        },
        data: { status: CaptchaChallengeStatus.EXPIRED, updated_at: now },
      });
      if (result.count === 1) {
        const refreshed = await this.findById(candidate.id);
        if (refreshed) {
          expired.push(refreshed);
        }
      }
    }
    return expired;
  }
}
