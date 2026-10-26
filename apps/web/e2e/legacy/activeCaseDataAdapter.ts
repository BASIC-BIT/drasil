// Explicit legacy test-build boundary. Never imported by the release build.
import {
  fixtureActiveCaseDetail,
  fixtureActiveCaseSummaries,
  fixtureParkedActiveCaseSummaries,
  fixtureResolvedCaseCount,
  fixtureResolvedCaseSummariesForHistory,
} from '@/lib/e2eFixtures';
import { sortCaseSummariesForQueue, type CaseDetail, type CaseSummary } from '@drasil/contracts';
import {
  type ActiveCaseDataAdapter,
  type CaseActionQueueResult,
  type QueueCaseActionInput,
} from '../../lib/activeCaseDataAdapter';
export * from '../../lib/activeCaseDataAdapter';

export class FixtureActiveCaseDataAdapter implements ActiveCaseDataAdapter {
  public canQueueCaseActions(): boolean {
    return true;
  }

  public async listActiveCases(): Promise<CaseSummary[]> {
    return sortCaseSummariesForQueue(fixtureActiveCaseSummaries());
  }

  public async listParkedCases(): Promise<CaseSummary[]> {
    return fixtureParkedActiveCaseSummaries();
  }

  public async listResolvedCases(_guildId: string): Promise<CaseSummary[]> {
    return sortCaseSummariesForHistory(fixtureResolvedCaseSummariesForHistory());
  }

  public async listCasesForMember(_guildId: string, userId: string): Promise<CaseSummary[]> {
    return sortCaseSummariesForHistory(
      [...fixtureActiveCaseSummaries(), ...fixtureResolvedCaseSummariesForHistory()].filter(
        (item) => item.userId === userId
      )
    );
  }

  public async countResolvedCases(): Promise<number> {
    return fixtureResolvedCaseCount();
  }

  public async getCaseDetail(_guildId: string, caseId: string): Promise<CaseDetail | null> {
    return fixtureActiveCaseDetail(caseId);
  }

  public async queueCaseAction(input: QueueCaseActionInput): Promise<CaseActionQueueResult> {
    const detail = fixtureActiveCaseDetail(input.caseId);
    if (!detail) {
      return {
        action: input.action,
        caseId: input.caseId,
        requestId: null,
        status: 'case_not_found',
      };
    }
    if (!detail.allowedActions.includes(input.action)) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }
    return {
      action: input.action,
      caseId: input.caseId,
      requestId: `fixture-case-action-${input.action}-${input.caseId}`,
      receipt: { id: `fixture-case-action-${input.action}-${input.caseId}`, status: 'queued' },
      status: 'queued',
    };
  }
}

export function createActiveCaseDataAdapter(): ActiveCaseDataAdapter {
  return new FixtureActiveCaseDataAdapter();
}

function sortCaseSummariesForHistory(cases: readonly CaseSummary[]): CaseSummary[] {
  return [...cases].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
