import {
  findMessageWatchlistMatch,
  getMessageDeletionSettings,
  type GlobalMessageWatchlistEntryInput,
} from '../../utils/messageDeletionSettings';

describe('messageDeletionSettings (unit)', () => {
  const globalWatchlistEntry: GlobalMessageWatchlistEntryInput = {
    id: 'global-video-link-entry',
    label: 'Global video/link watchlist entry',
    term: 'riskydomain.test',
    requiresLinkOrVideo: true,
  };

  it('has no source-defined watchlist entries by default', () => {
    const settings = getMessageDeletionSettings({});

    expect(settings.watchlistEntries).toEqual([]);
    expect(findMessageWatchlistMatch({ content: 'visit https://riskydomain.test' }, settings)).toBe(
      null
    );
  });

  it('matches database-provided global entries only when link or video evidence exists', () => {
    const settings = getMessageDeletionSettings({}, [globalWatchlistEntry]);

    expect(
      findMessageWatchlistMatch({ content: 'watch this https://riskydomain.test/video' }, settings)
    ).toEqual({
      entry: expect.objectContaining({ id: 'global-video-link-entry' }),
      matchedTerm: 'Global video/link watchlist entry',
    });
    expect(
      findMessageWatchlistMatch({ content: 'someone mentioned riskydomain.test' }, settings)
    ).toBe(null);
  });

  it('allows servers to disable global watchlist entries by ID', () => {
    const settings = getMessageDeletionSettings(
      {
        message_deletion_watchlist_disabled_default_ids: ['global-video-link-entry'],
      },
      [globalWatchlistEntry]
    );

    expect(findMessageWatchlistMatch({ content: 'visit https://riskydomain.test' }, settings)).toBe(
      null
    );
  });

  it('normalizes custom terms and applies the same link or video gate', () => {
    const settings = getMessageDeletionSettings({
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

  it('matches custom domain terms by exact host or subdomain boundary', () => {
    const settings = getMessageDeletionSettings({
      message_deletion_watchlist_custom_terms: ['baddomain.test'],
    });

    expect(
      findMessageWatchlistMatch({ content: 'visit https://login.baddomain.test/path' }, settings)
        ?.matchedTerm
    ).toBe('baddomain.test');
    expect(
      findMessageWatchlistMatch({ content: 'visit https://notbaddomain.test' }, settings)
    ).toBe(null);
    expect(
      findMessageWatchlistMatch({ content: 'visit https://baddomain.test.evil.example' }, settings)
    ).toBe(null);
  });

  it('builds stable custom entry IDs from normalized terms', () => {
    const initialSettings = getMessageDeletionSettings({
      message_deletion_watchlist_custom_terms: ['first.example', 'stable.example'],
    });
    const updatedSettings = getMessageDeletionSettings({
      message_deletion_watchlist_custom_terms: ['stable.example'],
    });

    expect(initialSettings.watchlistEntries[1].id).toBe(updatedSettings.watchlistEntries[0].id);
    expect(updatedSettings.watchlistEntries[0].id).toMatch(/^custom-[0-9a-f]{12}$/);
  });

  it('does not match when deletion or watchlist policy is disabled', () => {
    expect(
      findMessageWatchlistMatch(
        { content: 'https://riskydomain.test/video' },
        getMessageDeletionSettings({ message_deletion_enabled: false }, [globalWatchlistEntry])
      )
    ).toBe(null);
    expect(
      findMessageWatchlistMatch(
        { content: 'https://riskydomain.test/video' },
        getMessageDeletionSettings({ message_deletion_watchlist_enabled: false }, [
          globalWatchlistEntry,
        ])
      )
    ).toBe(null);
  });
});
