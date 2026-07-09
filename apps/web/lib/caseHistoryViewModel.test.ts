import { describe, expect, it } from 'vitest';
import { fixtureResolvedCaseSummaries } from './caseFixtures';
import { buildVisibleHistoryExportText, getVisibleHistoryCases } from './caseHistoryViewModel';

describe('caseHistoryViewModel', () => {
  it('filters resolved cases by presence and search text', () => {
    const cases = fixtureResolvedCaseSummaries();

    const visibleCases = getVisibleHistoryCases(cases, 'banned', 'resolved ban', 'newest');

    expect(visibleCases).toEqual([
      expect.objectContaining({
        presenceState: 'banned',
        userIdentity: expect.objectContaining({ displayLabel: 'Resolved Ban' }),
      }),
    ]);
  });

  it('sorts visible resolved cases by signal', () => {
    const cases = fixtureResolvedCaseSummaries();

    const visibleCases = getVisibleHistoryCases(cases, 'all', '', 'signal');

    expect(visibleCases[0]?.confidence).toBeGreaterThanOrEqual(visibleCases[1]?.confidence ?? 0);
  });

  it('builds a tab-separated visible history export packet', () => {
    const [firstCase] = fixtureResolvedCaseSummaries();

    const exportText = buildVisibleHistoryExportText('guild-1', [firstCase]);

    expect(exportText).toContain('case_id\tuser_id\tuser\tpresence');
    expect(exportText).toContain(firstCase.id);
    expect(exportText).toContain(`/admin/guild/guild-1/cases/${firstCase.id}`);
  });
});
