import { describe, expect, it } from 'vitest';
import {
  explicitInboxReturnHref,
  parseInboxLocation,
  serializeInboxLocation,
} from './inboxLocation';

describe('inbox location', () => {
  it('marks only a same-guild explicit return and keeps ordinary deep links unchanged', () => {
    const href = '/admin/guild/guild%2Fone/inbox?kind=case&sort=oldest&selected=case%3AB';
    const result = new URL(explicitInboxReturnHref('guild/one', href), 'https://internal.invalid');
    expect(result.searchParams.get('resume')).toBe('case:B');
    expect(parseInboxLocation(result.searchParams)).toEqual(
      parseInboxLocation(new URL(href, result.origin).searchParams)
    );
    for (const value of [
      '/admin/guild/foreign/inbox?selected=B',
      'https://outside.invalid/admin/guild/guild%2Fone/inbox?selected=B',
      '/admin/guild/guild%2Fone/inbox',
    ])
      expect(explicitInboxReturnHref('guild/one', value)).toBe(value);
    expect(
      serializeInboxLocation(parseInboxLocation(new URLSearchParams('selected=case%3AB'))).has(
        'resume'
      )
    ).toBe(false);
  });
  it('uses named presets, including all cases, and explicit valid controls override them', () => {
    expect(parseInboxLocation(new URLSearchParams('view=cases')).controls).toEqual({
      kind: 'case',
      freshness: 'all',
      sortMode: 'priority',
      searchQuery: '',
    });
    expect(
      parseInboxLocation(new URLSearchParams('view=reports&kind=case&sort=oldest')).controls
    ).toEqual({ kind: 'case', freshness: 'all', sortMode: 'oldest', searchQuery: '' });
  });
  it('rejects invalid filters and empty identities without losing the preset', () => {
    expect(
      parseInboxLocation(
        new URLSearchParams('view=reports&kind=wrong&freshness=wrong&sort=wrong&selected=&request=')
      )
    ).toEqual({
      controls: { kind: 'submitted_report', freshness: 'all', sortMode: 'newest', searchQuery: '' },
      selectedItemId: null,
      trackedRequestId: null,
    });
    expect(parseInboxLocation(new URLSearchParams('view=wrong')).controls.kind).toBe('all');
  });
  it('round trips arbitrary search text, selected IDs and durable request IDs canonically', () => {
    const location = {
      controls: {
        kind: 'all',
        freshness: 'attention',
        sortMode: 'oldest',
        searchQuery: '  + & = ? # / 日本語\n  ',
      },
      selectedItemId: 'queue:a & b',
      trackedRequestId: 'request:1&2',
    } as const;
    const encoded = serializeInboxLocation(location);
    expect(parseInboxLocation(new URLSearchParams(encoded.toString()))).toEqual(location);
    expect(serializeInboxLocation(parseInboxLocation(encoded)).toString()).toBe(encoded.toString());
  });
  it('derives the preset from controls and never attaches a request without selection', () => {
    const value = parseInboxLocation(new URLSearchParams('view=cases&request=orphan'));
    expect(value.trackedRequestId).toBeNull();
    expect(serializeInboxLocation(value).get('view')).toBe('cases');
  });
});
