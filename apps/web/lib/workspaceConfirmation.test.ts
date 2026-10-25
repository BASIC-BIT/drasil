import { describe, expect, it } from 'vitest';
import { assertWorkspaceConfirmation, resolveWorkspaceReturnTo } from './workspaceConfirmation';

function confirmed(): FormData {
  const form = new FormData();
  form.set('confirmAction', 'on');
  form.set('confirmedRecordId', 'record-1');
  form.set('confirmedTargetUserId', 'member-1');
  return form;
}
describe('workspace confirmation', () => {
  it.each(['confirmAction', 'confirmedRecordId', 'confirmedTargetUserId'])(
    'rejects missing %s',
    (field) => {
      const form = confirmed();
      form.delete(field);
      expect(() =>
        assertWorkspaceConfirmation(form, {
          recordId: 'record-1',
          targetUserId: 'member-1',
        })
      ).toThrow('Review and confirm');
    }
  );
  it.each(['confirmedRecordId', 'confirmedTargetUserId'])('rejects mismatched %s', (field) => {
    const form = confirmed();
    form.set(field, 'other');
    expect(() =>
      assertWorkspaceConfirmation(form, {
        recordId: 'record-1',
        targetUserId: 'member-1',
      })
    ).toThrow('Review and confirm');
  });
  it('allows confirmation of a report closure without a target', () => {
    const form = confirmed();
    form.delete('confirmedTargetUserId');
    expect(() =>
      assertWorkspaceConfirmation(form, {
        recordId: 'record-1',
        targetUserId: null,
      })
    ).not.toThrow();
  });
  it('accepts a confirmation bound to the freshly resolved record and member', () => {
    expect(() =>
      assertWorkspaceConfirmation(confirmed(), {
        recordId: 'record-1',
        targetUserId: 'member-1',
      })
    ).not.toThrow();
  });
  it('preserves the same-guild case return descriptor and rejects external/cross-guild returns', () => {
    const form = new FormData();
    const fallback = '/admin/guild/guild-1/cases/case-1';
    form.set(
      'returnTo',
      `${fallback}?returnTo=%2Fadmin%2Fguild%2Fguild-1%2Finbox%3Fkind%3Dcase#source`
    );
    expect(resolveWorkspaceReturnTo(form, 'guild-1', fallback)).toBe(form.get('returnTo'));
    for (const value of [
      'https://example.com',
      '//example.com',
      '/admin/guild/guild-2/inbox',
      '/admin/guild/guild-10/inbox',
    ]) {
      form.set('returnTo', value);
      expect(resolveWorkspaceReturnTo(form, 'guild-1', fallback)).toBe(fallback);
    }
  });
});
