import { presentApprovalResult } from './approvalPresentation';

describe('alternative approval outcomes', () => {
  it('distinguishes completed processing from busy and no-op domain outcomes', () => {
    expect(
      presentApprovalResult({ state: 'completed', outcome: { status: 'busy' } }).join('\n')
    ).toContain('Busy: no action was taken');
    expect(
      presentApprovalResult({ state: 'completed', outcome: { status: 'already_handled' } }).join(
        '\n'
      )
    ).toContain('Already handled: no new action was taken');
  });
  it('preserves report closure and failed cleanup separately', () => {
    const text = presentApprovalResult({
      state: 'partial',
      executionId: 'receipt',
      outcome: { status: 'closed', queueCleanupStatus: 'failed' },
    }).join('\n');
    expect(text).toContain('Report closed');
    expect(text).toContain('Queue cleanup failed');
    expect(text).toContain('Execution: receipt');
  });
  it('preserves every mixed attention item and safe uncertainty code', () => {
    const text = presentApprovalResult({
      state: 'partial',
      outcome: {
        items: [
          { itemId: 'one', state: 'completed', status: 'acknowledged' },
          { itemId: 'two', state: 'completed', status: 'already_handled' },
          { itemId: 'three', state: 'denied' },
          { itemId: 'four', state: 'uncertain' },
        ],
      },
    }).join('\n');
    for (const id of ['one', 'two', 'three', 'four']) expect(text).toContain(`Item ${id}:`);
    expect(text).toContain('Already handled: no new action was taken');
    expect(text).toContain('denied');
    const uncertain = presentApprovalResult({
      state: 'uncertain',
      executionId: 'receipt',
      code: 'completion_recording_failed',
    }).join('\n');
    expect(uncertain).toContain('completion_recording_failed');
    expect(uncertain).toContain('before starting another action');
  });
  it('projects only public outcome fields, preserving text as data', () => {
    expect(
      presentApprovalResult({
        state: 'denied',
        code: 'permission_denied',
        outcome: { status: '<script>@everyone😀', details: { closed_count: 2 } },
      }).join('\n')
    ).toContain('permission_denied');
    expect(
      presentApprovalResult({ state: 'completed', outcome: { details: { closed_count: 2 } } }).join(
        '\n'
      )
    ).toContain('Closed count: 2');
  });
});
