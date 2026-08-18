import { injectable } from 'inversify';
import {
  CaseContainmentStatus,
  CaseKind,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';

const ACTIVE_QUARANTINE_CACHE_TTL_MS = 30_000;

export interface IActiveAccountQuarantineCache {
  getActiveUserIds(
    serverId: string,
    loadPendingCases: () => Promise<VerificationEvent[]>
  ): Promise<ReadonlySet<string>>;
  noteActive(serverId: string, userId: string): void;
}

@injectable()
export class ActiveAccountQuarantineCache implements IActiveAccountQuarantineCache {
  private readonly entries = new Map<
    string,
    {
      readonly userIds: ReadonlySet<string>;
      readonly expiresAt: number;
      readonly activationVersion: number;
    }
  >();

  public async getActiveUserIds(
    serverId: string,
    loadPendingCases: () => Promise<VerificationEvent[]>
  ): Promise<ReadonlySet<string>> {
    const now = Date.now();
    const cached = this.entries.get(serverId);
    if (cached && cached.expiresAt > now) {
      return cached.userIds;
    }

    const pendingCases = await loadPendingCases();
    const userIds = new Set(
      pendingCases
        .filter(
          (event) =>
            event.status === VerificationStatus.PENDING &&
            event.case_kind === CaseKind.COMPROMISED_ACCOUNT &&
            event.containment_status !== CaseContainmentStatus.NOT_APPLICABLE
        )
        .map((event) => event.user_id)
    );
    const current = this.entries.get(serverId);
    if ((current?.activationVersion ?? 0) > (cached?.activationVersion ?? 0)) {
      for (const userId of current?.userIds ?? []) {
        userIds.add(userId);
      }
    }
    this.entries.set(serverId, {
      userIds,
      expiresAt: Date.now() + ACTIVE_QUARANTINE_CACHE_TTL_MS,
      activationVersion: current?.activationVersion ?? cached?.activationVersion ?? 0,
    });
    return userIds;
  }

  public noteActive(serverId: string, userId: string): void {
    const now = Date.now();
    const cached = this.entries.get(serverId);
    const userIds = new Set(cached?.userIds ?? []);
    userIds.add(userId);
    this.entries.set(serverId, {
      userIds,
      expiresAt: Math.max(cached?.expiresAt ?? 0, now + ACTIVE_QUARANTINE_CACHE_TTL_MS),
      activationVersion: (cached?.activationVersion ?? 0) + 1,
    });
  }
}
