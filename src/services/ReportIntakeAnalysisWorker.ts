import { activeReportEvidence } from '../utils/reportIntakeEvidence';
import { awaitReportLookup } from './ReportMemberDirectory';
import type { ReportAnalysisOutcome } from '@drasil/application';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import { processingMetadata } from '../repositories/reportIntakeProcessing';
import { ReportIntakeStatus, type ReportAnalysisClaim } from '../repositories/types';
import { getReportIntakeSettings } from '../utils/reportIntakeSettings';
import { IReportIntakeAgentService } from './ReportIntakeAgentService';

const POLL_MS = 5_000;
const MAX_CLAIMS = 5;
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const DEADLINE = Symbol('investigation deadline');

export interface IReportIntakeAnalysisWorker {
  start(): void;
  stop(): void;
  processPending(limit?: number): Promise<number>;
}

@injectable()
export class ReportIntakeAnalysisWorker implements IReportIntakeAnalysisWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing: Promise<number> | null = null;
  private owned: AbortController | null = null;
  private stopped = false;

  constructor(
    @inject(TYPES.ReportIntakeRepository) private repository: IReportIntakeRepository,
    @inject(TYPES.ConfigService) private config: IConfigService,
    @inject(TYPES.ReportIntakeAgentService) private agent: IReportIntakeAgentService
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const poll = (): void => {
      void this.processPending().catch(() => console.warn('Report intake analysis unavailable.'));
    };
    poll();
    this.timer = setInterval(poll, POLL_MS);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.owned?.abort();
  }

  async processPending(limit = MAX_CLAIMS): Promise<number> {
    if (this.processing) return this.processing;
    if (this.stopped) return 0;
    const processing = this.drain(Math.min(MAX_CLAIMS, Math.max(0, Math.floor(limit))));
    this.processing = processing;
    try {
      return await processing;
    } finally {
      if (this.processing === processing) this.processing = null;
    }
  }

  private async enabled(claim: ReportAnalysisClaim): Promise<boolean> {
    const config = await this.config.getServerConfig(claim.intake.server_id, {
      forceRefresh: true,
      failOnReadError: true,
    });
    return getReportIntakeSettings(config.settings).stagedEnabled;
  }

  private async drain(limit: number): Promise<number> {
    let processed = 0;
    while (!this.stopped && processed < limit) {
      const claim = await this.repository.claimAnalysis(new Date(), LEASE_MS);
      if (!claim || this.stopped) break;
      await this.processClaim(claim);
      processed++;
    }
    return processed;
  }

  private async processClaim(claim: ReportAnalysisClaim): Promise<void> {
    const controller = new AbortController();
    this.owned = controller;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing || controller.signal.aborted) return;
      renewing = true;
      void (async (): Promise<void> => {
        if (
          !(await this.enabled(claim)) ||
          !(await this.repository.renewAnalysisLease(claim, new Date(), LEASE_MS))
        )
          controller.abort();
      })()
        .catch(() => controller.abort())
        .finally(() => {
          renewing = false;
        });
    }, HEARTBEAT_MS);
    heartbeat.unref();
    const deadline =
      claim.kind === 'analyze'
        ? setTimeout(
            () => controller.abort(DEADLINE),
            Math.max(0, claim.deadline.getTime() - Date.now())
          )
        : null;
    try {
      if (!(await this.enabled(claim)) || this.stopped) return;
      const { analysis } = processingMetadata(claim.intake);
      let outcome: ReportAnalysisOutcome;
      if (claim.kind === 'confirmation_timeout') {
        outcome = {
          kind: 'admin_review',
          reason: 'confirmation_timeout',
          candidates: [],
          coverage: analysis.outcome?.coverage ?? { kind: 'unavailable', reason: 'transport' },
          includedEvidenceIds: analysis.outcome?.includedEvidenceIds ?? [],
          excludedEvidenceIds: analysis.outcome?.excludedEvidenceIds ?? [],
        };
      } else {
        try {
          if (Date.now() >= claim.deadline.getTime()) controller.abort(DEADLINE);
          controller.signal.throwIfAborted();
          outcome = await awaitReportLookup(
            this.agent.analyze({
              claim,
              signal: controller.signal,
              reserveModelAttempt: async () => {
                if (controller.signal.aborted || this.stopped || !(await this.enabled(claim)))
                  return false;
                if (controller.signal.aborted) return false;
                const reserved = await this.repository.reserveModelAttempt(claim, new Date());
                return reserved && !controller.signal.aborted && !this.stopped;
              },
            }),
            controller.signal
          );
          if (Date.now() >= claim.deadline.getTime()) controller.abort(DEADLINE);
          controller.signal.throwIfAborted();
        } catch {
          if (controller.signal.aborted && controller.signal.reason !== DEADLINE) return;
          outcome = {
            kind: 'admin_review',
            reason: 'provider_failure',
            candidates: [],
            coverage: { kind: 'unavailable', reason: 'transport' },
            includedEvidenceIds: [],
            excludedEvidenceIds: activeReportEvidence(
              claim.intake,
              await this.repository.listEvidence(claim.intake.id)
            ).map((row) => row.id),
          };
        }
      }
      if (
        this.stopped ||
        (controller.signal.aborted && controller.signal.reason !== DEADLINE) ||
        !(await this.enabled(claim))
      )
        return;
      if (this.stopped || (controller.signal.aborted && controller.signal.reason !== DEADLINE))
        return;
      if (
        outcome.kind === 'confirm' &&
        (analysis.handoff.state !== 'none' ||
          claim.intake.status === ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION)
      )
        outcome = {
          kind: 'admin_review',
          reason: analysis.handoff.state === 'none' ? 'ambiguous' : analysis.handoff.reason,
          candidates: [outcome.candidate],
          coverage: outcome.coverage,
          includedEvidenceIds: outcome.includedEvidenceIds,
          excludedEvidenceIds: outcome.excludedEvidenceIds,
        };
      await this.repository.completeAnalysis(claim, outcome, new Date());
    } finally {
      clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
      if (this.owned === controller) this.owned = null;
    }
  }
}
