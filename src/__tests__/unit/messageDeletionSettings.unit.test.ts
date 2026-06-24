import {
  findMessageWatchlistMatch,
  getMessageDeletionSettings,
  WICKEDPROXY_WATCHLIST_ENTRY_ID,
} from '../../utils/messageDeletionSettings';

describe('messageDeletionSettings (unit)', () => {
  it('matches the default wickedproxy watchlist only when link or video evidence exists', () => {
    const settings = getMessageDeletionSettings({});

    expect(
      findMessageWatchlistMatch(
        { content: 'watch this https://wickedproxy.example/video' },
        settings
      )?.entry.id
    ).toBe(WICKEDPROXY_WATCHLIST_ENTRY_ID);
    expect(findMessageWatchlistMatch({ content: 'someone mentioned wickedproxy' }, settings)).toBe(
      null
    );
  });

  it('allows servers to disable code-defined defaults', () => {
    const settings = getMessageDeletionSettings({
      message_deletion_watchlist_disabled_default_ids: [WICKEDPROXY_WATCHLIST_ENTRY_ID],
    });

    expect(
      findMessageWatchlistMatch({ content: 'https://wickedproxy.example/video' }, settings)
    ).toBe(null);
  });

  it('normalizes custom terms and applies the same link or video gate', () => {
    const settings = getMessageDeletionSettings({
      message_deletion_watchlist_disabled_default_ids: [WICKEDPROXY_WATCHLIST_ENTRY_ID],
      message_deletion_watchlist_custom_terms: ['  BadDomain.test ', 'baddomain.test'],
    });

    expect(settings.customWatchlistTerms).toEqual(['baddomain.test']);
    expect(
      findMessageWatchlistMatch({ content: 'visit https://baddomain.test now' }, settings)
        ?.matchedTerm
    ).toBe('baddomain.test');
    expect(findMessageWatchlistMatch({ content: 'baddomain.test discussion only' }, settings)).toBe(
      null
    );
  });

  it('does not match when deletion or watchlist policy is disabled', () => {
    expect(
      findMessageWatchlistMatch(
        { content: 'https://wickedproxy.example/video' },
        getMessageDeletionSettings({ message_deletion_enabled: false })
      )
    ).toBe(null);
    expect(
      findMessageWatchlistMatch(
        { content: 'https://wickedproxy.example/video' },
        getMessageDeletionSettings({ message_deletion_watchlist_enabled: false })
      )
    ).toBe(null);
  });
});
