import { ActiveAccountQuarantineCache } from '../../services/ActiveAccountQuarantineCache';
import {
  CaseContainmentStatus,
  CaseKind,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';

describe('ActiveAccountQuarantineCache', () => {
  it('preserves a newly activated quarantine while an older database load is in flight', async () => {
    const cache = new ActiveAccountQuarantineCache();
    let releaseLoad = (): void => undefined;
    const loadPendingCases = jest.fn(async (): Promise<VerificationEvent[]> => {
      await new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      return [];
    });

    const loading = cache.getActiveUserIds('guild-1', loadPendingCases);
    cache.noteActive('guild-1', 'user-newly-quarantined');
    releaseLoad();

    await expect(loading).resolves.toEqual(new Set(['user-newly-quarantined']));
    await expect(cache.getActiveUserIds('guild-1', loadPendingCases)).resolves.toContain(
      'user-newly-quarantined'
    );
    expect(loadPendingCases).toHaveBeenCalledTimes(1);
  });

  it('drops users that are no longer active when the cache expires', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
    const cache = new ActiveAccountQuarantineCache();
    const activeCase = {
      user_id: 'user-recovered',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      containment_status: CaseContainmentStatus.CONTAINED,
    } as VerificationEvent;
    const loadPendingCases = jest
      .fn<Promise<VerificationEvent[]>, []>()
      .mockResolvedValueOnce([activeCase])
      .mockResolvedValueOnce([]);

    await expect(cache.getActiveUserIds('guild-1', loadPendingCases)).resolves.toContain(
      'user-recovered'
    );
    jest.advanceTimersByTime(30_001);

    await expect(cache.getActiveUserIds('guild-1', loadPendingCases)).resolves.toEqual(new Set());
    expect(loadPendingCases).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
