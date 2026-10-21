import type { QueuedRequestRuntime } from '../application/requestDispatch';
import { prepareQueuedRequest } from '../application/requestRuntime';
import { inject, injectable } from 'inversify';
import { TYPES } from '../di/symbols';
import {
  getReportBanAttemptToken,
  IModerationActionRequestRepository,
} from '../repositories/ModerationActionRequestRepository';
import { ModerationActionRequest } from '../repositories/types';
import { IProductAnalyticsService } from './ProductAnalyticsService';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_REQUESTS_PER_TICK = 5;
const REQUEST_HEARTBEAT_INTERVAL_MS = 60_000;

export interface IModerationActionRequestService {
  start(): void;
  stop(): void;
  processPendingRequests(limit?: number): Promise<number>;
}

@injectable()
export class ModerationActionRequestService implements IModerationActionRequestService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processingPromise: Promise<number> | null = null;
  public constructor(
    @inject(TYPES.ModerationActionRequestRepository)
    private readonly repository: IModerationActionRequestRepository,
    @inject(TYPES.BotApplication)
    private readonly application: QueuedRequestRuntime,
    @inject(TYPES.ProductAnalyticsService)
    private readonly productAnalyticsService: IProductAnalyticsService
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.processPendingRequests().catch((error) => {
      console.warn('[ModerationActionRequest] Initial processing failed:', error);
    });
    this.timer = setInterval(() => {
      void this.processPendingRequests().catch((error) => {
        console.warn('[ModerationActionRequest] Background processing failed:', error);
      });
    }, this.resolvePollIntervalMs());
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  public async processPendingRequests(limit = DEFAULT_MAX_REQUESTS_PER_TICK): Promise<number> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    const processing = this.drainPendingRequests(limit);
    this.processingPromise = processing;
    try {
      return await processing;
    } finally {
      if (this.processingPromise === processing) {
        this.processingPromise = null;
      }
    }
  }

  private async drainPendingRequests(limit: number): Promise<number> {
    for (let index = 0; index < DEFAULT_MAX_REQUESTS_PER_TICK; index++) {
      const recovery = await this.repository.claimReportBanReconciliation(new Date());
      if (!recovery) break;
      const heartbeat = setInterval(() => {
        void this.repository
          .heartbeat(recovery.id, getReportBanAttemptToken(recovery))
          .catch((error) => console.warn('Report ban lease renewal failed:', error));
      }, REQUEST_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      try {
        await this.executeRequest(recovery, true);
      } catch (error) {
        console.warn('Report ban reconciliation failed:', error);
      } finally {
        clearInterval(heartbeat);
      }
    }
    let processed = 0;
    while (processed < limit) {
      const request = await this.repository.claimNext();
      if (!request) {
        return processed;
      }

      await this.processClaimedRequest(request);
      processed += 1;
    }

    return processed;
  }

  private async processClaimedRequest(request: ModerationActionRequest): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.repository
        .heartbeat(request.id, getReportBanAttemptToken(request))
        .catch((error) => {
          console.warn(`Failed to heartbeat moderation action request ${request.id}:`, error);
        });
    }, REQUEST_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      await this.executeRequest(request);
    } catch (error) {
      await this.repository.fail(
        request.id,
        this.errorMessage(error),
        getReportBanAttemptToken(request)
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeRequest(request: ModerationActionRequest, recovery = false): Promise<void> {
    const execution = await prepareQueuedRequest({
      runtime: this.application,
      request,
      analytics: this.productAnalyticsService,
      recovery,
    });
    if (execution.persistence === 'observe_only') {
      // A replay is not the execution owner; neither success nor read failure may
      // overwrite a winner's durable queue outcome.
      try {
        await execution.execute();
      } catch {
        console.warn('Native enforcement observation unavailable.');
      }
      return;
    }
    const outcome = await execution.execute();
    if (
      recovery &&
      outcome.action_type === 'ban_observed_detection' &&
      outcome.observed_ban_result.status === 'already_handled'
    )
      return;
    const completed = await this.repository.complete(
      request.id,
      outcome,
      getReportBanAttemptToken(request)
    );
    if (
      !completed ||
      completed.status !== 'completed' ||
      getReportBanAttemptToken(completed) !== getReportBanAttemptToken(request)
    )
      return;
    await execution.onComplete?.(completed.result);
    await execution.afterComplete?.();
  }

  private resolvePollIntervalMs(): number {
    const configured = Number(process.env.DRASIL_ACTION_REQUEST_POLL_MS);
    if (Number.isInteger(configured) && configured > 0) {
      return configured;
    }

    return DEFAULT_POLL_INTERVAL_MS;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
