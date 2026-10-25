import { describe, expect, it } from 'vitest';
import { chooseInboxContinuation } from './inboxContinuation';

describe('inbox continuation', () => {
  it('restores an existing selection', () => {
    expect(
      chooseInboxContinuation({
        previousIds: ['a', 'b'],
        selectedId: 'b',
        currentItems: [{ id: 'a' }, { id: 'b' }],
      })
    ).toBe('b');
  });
  it('chooses the next old survivor ahead of newly arrived rows', () => {
    expect(
      chooseInboxContinuation({
        previousIds: ['a', 'b', 'c'],
        selectedId: 'b',
        currentItems: [{ id: 'new' }, { id: 'a' }, { id: 'c' }],
      })
    ).toBe('c');
  });
  it('uses the nearest previous survivor when later rows were removed', () => {
    expect(
      chooseInboxContinuation({
        previousIds: ['a', 'b', 'c'],
        selectedId: 'c',
        currentItems: [{ id: 'new' }, { id: 'a' }, { id: 'b' }],
      })
    ).toBe('b');
  });
  it('falls back to the first current match for an unknown or wholly removed ordering', () => {
    expect(
      chooseInboxContinuation({
        previousIds: ['a', 'b'],
        selectedId: 'b',
        currentItems: [{ id: 'new' }],
      })
    ).toBe('new');
    expect(
      chooseInboxContinuation({ previousIds: [], selectedId: null, currentItems: [{ id: 'new' }] })
    ).toBe('new');
  });
  it('returns null with no matches', () => {
    expect(
      chooseInboxContinuation({ previousIds: ['a', 'b'], selectedId: 'b', currentItems: [] })
    ).toBeNull();
  });
});
