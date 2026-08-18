import { CaseRoleReleaseReconciliationService } from '../../services/CaseRoleReleaseReconciliationService';
import {
  CASE_ROLE_RELEASE_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_LEASE_MS,
} from '../../utils/caseRoleRelease';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  VerificationStatus,
} from '../../repositories/types';
import { InMemoryVerificationEventRepository } from '../fakes/inMemoryRepositories';

describe('CaseRoleReleaseReconciliationService (unit)', () => {
  it('restores the case role and clears an expired release claim', async () => {
    const now = new Date('2026-08-18T12:00:00.000Z');
    const staleBefore = new Date(now.getTime() - CASE_ROLE_RELEASE_LEASE_MS);
    const verificationEventRepository = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T10:00:00.000Z'),
      parked_by: 'moderator-1',
    });
    await verificationEventRepository.claimCaseRoleRelease(
      verificationEvent.id,
      'guild-1',
      'user-1',
      `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}crashed`,
      new Date(0)
    );
    await verificationEventRepository.update(verificationEvent.id, {
      quarantine_lease_renewed_at: staleBefore,
    });

    const member = { id: 'user-1' };
    const guild = { members: { fetch: jest.fn().mockResolvedValue(member) } };
    const client = {
      guilds: {
        cache: new Map([['guild-1', guild]]),
        fetch: jest.fn(),
      },
    };
    const roleManager = {
      assignCaseRole: jest.fn().mockResolvedValue(true),
      removeCaseRole: jest.fn(),
    };
    const service = new CaseRoleReleaseReconciliationService(
      client as any,
      verificationEventRepository,
      roleManager as any
    );

    await service.runOnce(now);

    expect(guild.members.fetch).toHaveBeenCalledWith('user-1');
    expect(roleManager.assignCaseRole).toHaveBeenCalledWith(member);
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        quarantine_attempt_id: null,
        quarantine_lease_renewed_at: null,
      })
    );
  });
});
