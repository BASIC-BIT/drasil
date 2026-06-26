import {
  CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID,
  DEFAULT_MESSAGE_WATCHLIST_ENTRIES,
  findMessageWatchlistMatch,
  getMessageDeletionSettings,
} from '../../utils/messageDeletionSettings';

describe('messageDeletionSettings (unit)', () => {
  const codeDefinedVideoLinkTerm = DEFAULT_MESSAGE_WATCHLIST_ENTRIES[0].terms[0];

  it('matches the code-defined watchlist only when link or video evidence exists', () => {
    const settings = getMessageDeletionSettings({});

    expect(
      findMessageWatchlistMatch(
        { content: `watch this https://${codeDefinedVideoLinkTerm}.example/video` },
        settings
      )?.entry.id
    ).toBe(CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID);
    expect(
      findMessageWatchlistMatch(
        { content: `someone mentioned ${codeDefinedVideoLinkTerm}` },
        settings
      )
    ).toBe(null);
  });

  it('allows servers to disable code-defined defaults', () => {
    const settings = getMessageDeletionSettings({
      message_deletion_watchlist_disabled_default_ids: [CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID],
    });

    expect(
      findMessageWatchlistMatch(
        { content: `https://${codeDefinedVideoLinkTerm}.example/video` },
        settings
      )
    ).toBe(null);
  });

  it('normalizes custom terms and applies the same link or video gate', () => {
    const settings = getMessageDeletionSettings({
      message_deletion_watchlist_disabled_default_ids: [CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID],
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
      message_deletion_watchlist_disabled_default_ids: [CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID],
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
      message_deletion_watchlist_disabled_default_ids: [CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID],
      message_deletion_watchlist_custom_terms: ['first.example', 'stable.example'],
    });
    const updatedSettings = getMessageDeletionSettings({
      message_deletion_watchlist_disabled_default_ids: [CODE_DEFINED_VIDEO_LINK_WATCHLIST_ENTRY_ID],
      message_deletion_watchlist_custom_terms: ['stable.example'],
    });

    expect(initialSettings.watchlistEntries[1].id).toBe(updatedSettings.watchlistEntries[0].id);
    expect(updatedSettings.watchlistEntries[0].id).toMatch(/^custom-[0-9a-f]{12}$/);
  });

  it('does not match when deletion or watchlist policy is disabled', () => {
    expect(
      findMessageWatchlistMatch(
        { content: `https://${codeDefinedVideoLinkTerm}.example/video` },
        getMessageDeletionSettings({ message_deletion_enabled: false })
      )
    ).toBe(null);
    expect(
      findMessageWatchlistMatch(
        { content: `https://${codeDefinedVideoLinkTerm}.example/video` },
        getMessageDeletionSettings({ message_deletion_watchlist_enabled: false })
      )
    ).toBe(null);
  });
});
