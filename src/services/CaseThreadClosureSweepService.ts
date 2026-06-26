import { inject, injectable } from 'inversify';
import { TYPES } from '../di/symbols';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { VerificationEvent, VerificationStatus } from '../repositories/types';
import { IThreadManager, ResolvedThreadClosureResult } from './ThreadManager';

export interface CaseThreadClosureSweepOptions {
  readonly serverId: string;
  readonly execute?: boolean;
  readonly days?: number | null;
  readonly limit?: number | null;
  readonly userId?: string | null;
}

export interface CaseThreadClosureSweepCaseResult {
  readonly verificationEventId: string;
  readonly userId: string;
  readonly status: VerificationStatus;
  readonly threadResults: ResolvedThreadClosureResult[];
}

export interface CaseThreadClosureSweepReport {
  readonly execute: boolean;
  readonly days: number;
  readonly limit: number;
  readonly checkedCases: number;
  readonly checkedThreads: number;
  readonly wouldCloseThreads: number;
  readonly closedThreads: number;
  readonly alreadyClosedThreads: number;
  readonly missingThreads: number;
  readonly failedThreads: number;
  readonly cases: CaseThreadClosureSweepCaseResult[];
}

export interface ICaseThreadClosureSweepService {
  sweepResolvedCaseThreads(
    options: CaseThreadClosureSweepOptions
  ): Promise<CaseThreadClosureSweepReport>;
}

@injectable()
export class CaseThreadClosureSweepService implements ICaseThreadClosureSweepService {
  public constructor(
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.ThreadManager)
    private readonly threadManager: IThreadManager
  ) {}

  public async sweepResolvedCaseThreads(
    options: CaseThreadClosureSweepOptions
  ): Promise<CaseThreadClosureSweepReport> {
    const days = Math.max(1, Math.min(options.days ?? 30, 365));
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const execute = options.execute === true;
    const verificationEvents =
      await this.verificationEventRepository.findResolvedWithThreadsByServer(options.serverId, {
        days,
        limit,
        userId: options.userId ?? null,
      });
    const cases: CaseThreadClosureSweepCaseResult[] = [];

    for (const verificationEvent of verificationEvents) {
      const result = await this.threadManager.closeResolvedVerificationThreads(verificationEvent, {
        execute,
      });
      cases.push(this.formatCaseResult(verificationEvent, result.results));
    }

    const threadResults = cases.flatMap((caseResult) => caseResult.threadResults);
    return {
      execute,
      days,
      limit,
      checkedCases: verificationEvents.length,
      checkedThreads: threadResults.length,
      wouldCloseThreads: threadResults.filter((result) => result.wouldClose).length,
      closedThreads: threadResults.filter((result) => result.closed).length,
      alreadyClosedThreads: threadResults.filter((result) => result.alreadyClosed).length,
      missingThreads: threadResults.filter((result) => result.missing).length,
      failedThreads: threadResults.filter((result) => result.error !== null).length,
      cases,
    };
  }

  private formatCaseResult(
    verificationEvent: VerificationEvent,
    threadResults: ResolvedThreadClosureResult[]
  ): CaseThreadClosureSweepCaseResult {
    return {
      verificationEventId: verificationEvent.id,
      userId: verificationEvent.user_id,
      status: verificationEvent.status,
      threadResults,
    };
  }
}
