import { runEvaluation, evaluateLabels } from '../../scripts/evaluateReportIntake';
import { GPTService } from '../../services/GPTService';
import { associatedOutput } from '../fixtures/report-intake/source-associated';

describe('synthetic report evaluation', () => {
  it('validates all bundled images without provider opt-in or credentials', async () => {
    const extract = jest.spyOn(GPTService.prototype, 'extractReportIdentityFixture');
    const output = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runEvaluation([])).toMatchObject({
        mode: 'dry-run',
        maximumRequests: 3,
        requestCount: 0,
      });
      expect(extract).not.toHaveBeenCalled();
      expect(output).toHaveBeenCalledWith(expect.stringContaining('Maximum provider requests: 3'));
    } finally {
      extract.mockRestore();
      output.mockRestore();
    }
  });
  it('rejects unknown flags instead of treating them as approval', async () => {
    await expect(runEvaluation(['--execute'])).rejects.toThrow('Usage:');
  });
  it('checks subject roles and readability without requiring exact prose', () => {
    const extraction = {
      kind: 'extracted' as const,
      ...associatedOutput(),
      includedEvidenceIds: ['evidence-text'],
      excludedEvidenceIds: [],
    };
    const label = {
      subjects: [{ role: 'target' as const, readableNames: ['Alder'] }],
      contextLabels: ['Synthetic workshop'],
      uncertaintyRequired: false,
      permittedIdentityOutcome: 'confirm' as const,
    };
    expect(evaluateLabels(extraction, label)).toEqual([]);
    extraction.subjects[0].role = 'other';
    expect(evaluateLabels(extraction, label)).toContain('missing target: Alder');
  });
  it('fails uncertain labels when an extraction invents certainty', () => {
    const extraction = {
      kind: 'extracted' as const,
      ...associatedOutput(),
      includedEvidenceIds: ['evidence-text'],
      excludedEvidenceIds: [],
    };
    expect(
      evaluateLabels(extraction, {
        subjects: [],
        contextLabels: [],
        uncertaintyRequired: true,
        permittedIdentityOutcome: 'admin_review',
      })
    ).toContain('missing target uncertainty');
  });
  it('rejects a bystander name attached to the target as well as the correct subject', () => {
    const extraction = {
      kind: 'extracted' as const,
      ...associatedOutput(),
      includedEvidenceIds: ['evidence-text'],
      excludedEvidenceIds: [],
    };
    extraction.subjects[0].displayNames.push('Finch');
    expect(
      evaluateLabels(extraction, {
        subjects: [
          { role: 'target', readableNames: ['Alder'] },
          { role: 'other', readableNames: ['Finch'] },
        ],
        contextLabels: [],
        uncertaintyRequired: false,
        permittedIdentityOutcome: 'confirm',
      })
    ).toContain('wrong subject for Finch');
  });
});
