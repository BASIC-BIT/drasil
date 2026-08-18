import { randomUUID } from 'node:crypto';
import { Client } from 'discord.js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../di/symbols';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { CaseAttentionState, CaseContainmentStatus, CaseKind } from '../repositories/types';
import {
  CASE_ROLE_RELEASE_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_LEASE_MS,
} from '../utils/caseRoleRelease';
import { IRoleManager } from './RoleManager';

const CASE_ROLE_RELEASE_RECONCILIATION_INTERVAL_MS = 60 * 1000;

export interface ICaseRoleReleaseReconciliationService {
  start(): void;
  stop(): void;
  runOnce(now?: Date): Promise<void>;
}

@injectable()
export class CaseRoleReleaseReconciliationService implements ICaseRoleReleaseReconciliationService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @inject(TYPES.DiscordClient) private readonly client: Client,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.RoleManager) private readonly roleManager: IRoleManager
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, CASE_ROLE_RELEASE_RECONCILIATION_INTERVAL_MS);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  public async runOnce(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const staleBefore = new Date(now.getTime() - CASE_ROLE_RELEASE_LEASE_MS);
      const expiredClaims =
        await this.verificationEventRepository.findExpiredCaseRoleReleases(staleBefore);
      for (const verificationEvent of expiredClaims) {
        await this.reconcileCaseRole(verificationEvent.id, staleBefore).catch((error) => {
          console.error(
            `Failed to reconcile expired case-role release for case ${verificationEvent.id}:`,
            error
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async reconcileCaseRole(verificationEventId: string, staleBefore: Date): Promise<void> {
    const candidate = await this.verificationEventRepository.findById(verificationEventId);
    if (!candidate) {
      return;
    }

    const attemptId = `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}reconcile:${randomUUID()}`;
    const claimed = await this.verificationEventRepository.claimCaseRoleRelease(
      candidate.id,
      candidate.server_id,
      candidate.user_id,
      attemptId,
      staleBefore
    );
    if (!claimed) {
      return;
    }

    try {
      const guild =
        this.client.guilds.cache.get(claimed.server_id) ??
        (await this.client.guilds.fetch(claimed.server_id));
      const member = await guild.members.fetch(claimed.user_id);
      const restored = await this.roleManager.assignCaseRole(member);
      if (!restored) {
        throw new Error('Configured case role could not be restored.');
      }

      const completed = await this.verificationEventRepository.updateQuarantineAttempt(
        claimed.id,
        attemptId,
        {
          case_kind: CaseKind.COMPROMISED_ACCOUNT,
          attention_state: CaseAttentionState.PARKED,
          containment_status: CaseContainmentStatus.CONTAINED,
          parked_at: claimed.parked_at,
          parked_by: claimed.parked_by,
        }
      );
      if (!completed) {
        throw new Error('Release-recovery ownership changed before completion.');
      }
    } catch (error) {
      await this.verificationEventRepository.updateQuarantineAttempt(claimed.id, attemptId, {
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
      });
      throw error;
    }
  }
}
