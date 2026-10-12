import { Client, Collection, Message, TextChannel } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import { ReportInstructionsManager } from '../../controllers/ReportInstructionsManager';
import { ServerSettings } from '../../repositories/types';

function buildManager(guildId: string) {
  const canReadHistory = jest.fn().mockReturnValue(true);
  let settings: ServerSettings = {
    report_instructions_channel_id: 'channel',
    report_instructions_message_id: '100',
  };
  const oldMessage = {
    id: '100',
    author: { id: 'bot' },
    embeds: [{ title: 'Report a User' }],
    components: [{ components: [{ customId: 'report_user_initiate' }] }],
    edit: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const newMessage = {
    ...oldMessage,
    id: '200',
    edit: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const fetch = jest.fn(async (id: string | { limit: number }) => {
    if (typeof id !== 'string') {
      return id.limit === 1
        ? new Collection([['100', oldMessage as unknown as Message]])
        : new Collection<string, Message>();
    }
    return id === '100' ? oldMessage : newMessage;
  });
  const channel = {
    id: 'channel',
    permissionsFor: jest.fn().mockReturnValue({ has: canReadHistory }),
    messages: { fetch },
    send: jest.fn().mockResolvedValue(newMessage),
  };
  const client = {
    user: { id: 'bot' },
    channels: { fetch: jest.fn().mockResolvedValue(channel) },
  };
  const save = async (_id: string, patch: Partial<ServerSettings>) => {
    settings = { ...settings, ...patch };
    return { settings };
  };
  const config = {
    getServerConfig: jest.fn(async () => ({ settings: { ...settings } })),
    updateServerSettings: jest.fn(save),
  };
  const manager = new ReportInstructionsManager(
    client as unknown as Client,
    config as unknown as IConfigService
  );
  const upsert = (repost = true, expectedMessageId: string | null = '100') =>
    manager.upsertReportInstructionsMessage(guildId, channel as unknown as TextChannel, {
      repost,
      expectedMessageId,
    });
  return {
    canReadHistory,
    channel,
    client,
    config,
    manager,
    newMessage,
    oldMessage,
    save,
    upsert,
    settings: () => settings,
  };
}

describe('ReportInstructionsManager deliberate repost', () => {
  it('keeps a repost-triggered move durable after finishing earlier cleanup', async () => {
    const fixture = buildManager('cleanup-then-move');
    await fixture.save('cleanup-then-move', {
      report_instructions_message_id: '200',
      report_instructions_cleanup_channel_id: 'channel',
      report_instructions_cleanup_message_id: '100',
    });
    const replacement = {
      ...fixture.newMessage,
      id: '300',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const source = {
      ...fixture.channel,
      messages: {
        fetch: jest.fn(async (id: string) =>
          id === '100' ? fixture.oldMessage : fixture.newMessage
        ),
      },
    };
    fixture.channel.id = 'target';
    fixture.channel.send.mockResolvedValue(replacement);
    fixture.channel.messages.fetch.mockImplementation(async (id) =>
      typeof id === 'string' ? replacement : new Collection<string, Message>()
    );
    fixture.client.channels.fetch.mockImplementation(async (id: string) =>
      id === 'channel' ? source : fixture.channel
    );
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockImplementationOnce(fixture.save)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert(true, '200')).rejects.toThrow('Retry setup to recover');
    expect(replacement.delete).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_pending_publication).toEqual({
      channel_id: 'target',
      after_message_id: null,
    });
    await fixture.upsert(true, '200');
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_message_id).toBe('300');
    expect(fixture.newMessage.delete).toHaveBeenCalledTimes(1);
  });
  it('retains recovery state when history is hidden by missing permissions', async () => {
    const fixture = buildManager('hidden-history');
    await fixture.save('hidden-history', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '100' },
    });
    fixture.canReadHistory.mockReturnValue(false);
    await expect(fixture.upsert()).rejects.toThrow('Read Message History');
    expect(fixture.settings().report_instructions_pending_publication).not.toBeNull();
    expect(fixture.config.updateServerSettings).not.toHaveBeenCalled();
    expect(fixture.channel.send).not.toHaveBeenCalled();
    fixture.canReadHistory.mockReturnValue(true);
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () => new Collection([['200', fixture.newMessage as unknown as Message]])
    );
    await fixture.upsert();
    expect(fixture.settings().report_instructions_message_id).toBe('200');
    expect(fixture.channel.send).not.toHaveBeenCalled();
  });

  it('does not treat empty history as absence if permission is lost during the read', async () => {
    const fixture = buildManager('history-permission-race');
    await fixture.save('history-permission-race', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '100' },
    });
    fixture.channel.messages.fetch.mockImplementationOnce(async () => {
      fixture.canReadHistory.mockReturnValue(false);
      return new Collection<string, Message>();
    });
    await expect(fixture.upsert()).rejects.toThrow('Read Message History');
    expect(fixture.config.updateServerSettings).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_pending_publication).not.toBeNull();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
  });

  it('does not record a new intent or send when repost history cannot be read', async () => {
    const fixture = buildManager('repost-no-history');
    fixture.canReadHistory.mockReturnValue(false);
    await expect(fixture.upsert()).rejects.toThrow('Read Message History');
    expect(fixture.config.updateServerSettings).not.toHaveBeenCalled();
    expect(fixture.channel.send).not.toHaveBeenCalled();
  });
  it('clears a publication intent whose destination channel no longer exists', async () => {
    const fixture = buildManager('deleted-intent-channel');
    await fixture.save('deleted-intent-channel', {
      report_instructions_pending_publication: { channel_id: 'deleted', after_message_id: '100' },
    });
    fixture.client.channels.fetch.mockRejectedValueOnce({ code: 10003 });
    await fixture.upsert(false);
    expect(fixture.settings().report_instructions_pending_publication).toBeNull();
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
  });
  it('clears a failed-send intent after ordinary repair proves no replacement exists', async () => {
    const fixture = buildManager('failed-send-repair');
    fixture.channel.send.mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('Discord unavailable');
    expect(fixture.settings().report_instructions_pending_publication).not.toBeNull();
    await fixture.upsert(false);
    expect(fixture.settings().report_instructions_pending_publication).toBeNull();
    fixture.channel.messages.fetch.mockClear();
    await fixture.manager.clearReportInstructions('failed-send-repair');
    expect(fixture.channel.messages.fetch).toHaveBeenCalledWith('100');
    expect(fixture.channel.messages.fetch).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
  });
  it('does not clear panels when the durable state cannot be read', async () => {
    const fixture = buildManager('clear-read-failure');
    fixture.config.getServerConfig.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.manager.clearReportInstructions('clear-read-failure')).rejects.toThrow(
      'database unavailable'
    );
    expect(fixture.config.updateServerSettings).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    expect(fixture.config.getServerConfig).toHaveBeenCalledWith('clear-read-failure', {
      failOnReadError: true,
      forceRefresh: true,
    });
  });
  it('adopts an untracked first panel after a restart without sending or deleting it', async () => {
    const fixture = buildManager('restart-first-panel');
    await fixture.save('restart-first-panel', {
      report_instructions_channel_id: null,
      report_instructions_message_id: null,
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: null },
    });
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () => new Collection([['200', fixture.newMessage as unknown as Message]])
    );
    await expect(fixture.upsert(true, null)).resolves.toEqual({
      action: 'updated',
      messageId: '200',
    });
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_pending_publication).toBeNull();
  });

  it('starts fresh repost recovery at the latest channel message rather than the old panel', async () => {
    const fixture = buildManager('recent-boundary');
    fixture.newMessage.id = '9001';
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () =>
        new Collection([['9000', { id: '9000', author: { id: 'human' } } as unknown as Message]])
    );
    await fixture.upsert();
    expect(fixture.channel.messages.fetch).toHaveBeenCalledWith({ limit: 1 });
    expect(fixture.config.updateServerSettings).toHaveBeenNthCalledWith(1, 'recent-boundary', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '9000' },
    });
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
  });

  it('stops at the recovery page limit without sending or deleting any panel', async () => {
    const fixture = buildManager('recovery-budget');
    await fixture.save('recovery-budget', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '100' },
    });
    let newestId = 5000;
    fixture.channel.messages.fetch.mockImplementation(async () => {
      const messages = new Collection<string, Message>();
      for (let index = 0; index < 100; index++) {
        const id = String(newestId--);
        messages.set(id, { id, author: { id: 'human' } } as unknown as Message);
      }
      return messages;
    });
    await expect(fixture.upsert()).rejects.toThrow('recovery exceeded its history limit');
    expect(fixture.channel.messages.fetch).toHaveBeenCalledTimes(10);
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    expect(fixture.config.updateServerSettings).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_pending_publication).not.toBeNull();
  });
  it('keeps ordinary first setup working without history permission', async () => {
    const fixture = buildManager('ordinary-no-history');
    fixture.canReadHistory.mockReturnValue(false);
    await fixture.save('ordinary-no-history', {
      report_instructions_channel_id: null,
      report_instructions_message_id: null,
    });
    fixture.channel.messages.fetch.mockResolvedValueOnce(new Collection<string, Message>());
    await expect(fixture.upsert(false)).resolves.toEqual({ action: 'sent', messageId: '200' });
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
  });

  it('does not publish if the durable intent cannot be saved', async () => {
    const fixture = buildManager('intent-save-failure');
    fixture.config.updateServerSettings.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('database unavailable');
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
  });

  it('recovers and removes both panels when clearing after a restart', async () => {
    const fixture = buildManager('restart-clear');
    await fixture.save('restart-clear', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '100' },
    });
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () => new Collection([['200', fixture.newMessage as unknown as Message]])
    );
    await expect(fixture.manager.clearReportInstructions('restart-clear')).resolves.toEqual({
      action: 'cleared',
    });
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.newMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.settings()).toMatchObject({
      report_instructions_channel_id: null,
      report_instructions_message_id: null,
      report_instructions_pending_publication: null,
    });
  });

  it('recovers a moved replacement using the saved target intent after a restart', async () => {
    const fixture = buildManager('restart-moved');
    fixture.channel.id = 'target';
    const sourceChannel = {
      ...fixture.channel,
      id: 'channel',
      messages: { fetch: jest.fn().mockResolvedValue(fixture.oldMessage) },
    };
    fixture.client.channels.fetch.mockImplementation(async (id: string) =>
      id === 'target' ? fixture.channel : sourceChannel
    );
    await fixture.save('restart-moved', {
      report_instructions_pending_publication: { channel_id: 'target', after_message_id: '100' },
    });
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () => new Collection([['200', fixture.newMessage as unknown as Message]])
    );
    await fixture.upsert();
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.settings()).toMatchObject({
      report_instructions_channel_id: 'target',
      report_instructions_message_id: '200',
      report_instructions_pending_publication: null,
    });
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
  });

  it('recovers an untracked newer panel from channel history after a restart', async () => {
    const fixture = buildManager('restart-recovery');
    await fixture.save('restart-recovery', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '100' },
    });
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () =>
        new Collection([
          ['200', fixture.newMessage as unknown as Message],
          ['100', fixture.oldMessage as unknown as Message],
        ])
    );
    await expect(fixture.upsert()).resolves.toEqual({ action: 'updated', messageId: '200' });
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_message_id).toBe('200');
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
  });

  it('searches past a full page of newer unrelated messages for a replacement', async () => {
    const fixture = buildManager('paginated-recovery');
    await fixture.save('paginated-recovery', {
      report_instructions_pending_publication: { channel_id: 'channel', after_message_id: '100' },
    });
    const unrelated = new Collection<string, Message>();
    for (let id = 500; id > 400; id--) {
      unrelated.set(String(id), { id: String(id), author: { id: 'human' } } as unknown as Message);
    }
    fixture.channel.messages.fetch
      .mockImplementationOnce(async () => unrelated)
      .mockImplementationOnce(
        async () => new Collection([['200', fixture.newMessage as unknown as Message]])
      );
    await fixture.upsert();
    expect(fixture.channel.messages.fetch).toHaveBeenNthCalledWith(2, {
      limit: 100,
      before: '401',
    });
    expect(fixture.channel.send).not.toHaveBeenCalled();
  });

  it('blocks publishing if recovery history cannot be read', async () => {
    const fixture = buildManager('history-failure');
    fixture.channel.messages.fetch.mockRejectedValueOnce(new Error('missing history permission'));
    await expect(fixture.upsert()).rejects.toThrow('missing history permission');
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
  });

  it('retains a first working panel when its settings cannot be saved', async () => {
    const fixture = buildManager('first-panel-save-failure');
    await fixture.save('first-panel-save-failure', {
      report_instructions_channel_id: null,
      report_instructions_message_id: null,
    });
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert(true, null)).rejects.toThrow('Retry setup to recover');
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
    await fixture.upsert(true, null);
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_message_id).toBe('200');
  });

  it('sends the existing button payload, saves replacement coordinates, then deletes the old panel', async () => {
    const fixture = buildManager('repost-success');
    await expect(fixture.upsert()).resolves.toEqual({ action: 'reposted', messageId: '200' });
    const payload = fixture.channel.send.mock.calls[0][0];
    expect(payload.components[0].toJSON().components[0].custom_id).toBe('report_user_initiate');
    expect(payload.enforceNonce).toBe(true);
    expect(fixture.config.updateServerSettings).toHaveBeenNthCalledWith(2, 'repost-success', {
      report_instructions_pending_publication: null,
      report_instructions_channel_id: 'channel',
      report_instructions_message_id: '200',
      report_instructions_cleanup_channel_id: 'channel',
      report_instructions_cleanup_message_id: '100',
    });
    expect(fixture.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.config.updateServerSettings.mock.invocationCallOrder[1]
    );
    expect(fixture.config.updateServerSettings.mock.invocationCallOrder[1]).toBeLessThan(
      fixture.oldMessage.delete.mock.invocationCallOrder[0]
    );
    expect(fixture.settings().report_instructions_cleanup_message_id).toBeNull();
    expect(fixture.oldMessage.edit).not.toHaveBeenCalled();
  });

  it('keeps ordinary repair in place', async () => {
    const fixture = buildManager('ordinary-repair');
    await expect(fixture.upsert(false)).resolves.toEqual({
      action: 'updated',
      messageId: '100',
    });
    expect(fixture.oldMessage.edit).toHaveBeenCalledTimes(1);
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
  });

  it('leaves the old panel and settings intact when send fails', async () => {
    const fixture = buildManager('send-failure');
    fixture.channel.send.mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('Discord unavailable');
    expect(fixture.config.updateServerSettings).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_pending_publication).toEqual({
      channel_id: 'channel',
      after_message_id: '100',
    });
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_message_id).toBe('100');
  });

  it('retains the replacement when persistence fails and recovers it without another send', async () => {
    const fixture = buildManager('save-failure');
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('Retry setup to recover');
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_message_id).toBe('100');
    await fixture.upsert();
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_message_id).toBe('200');
  });

  it('does not roll back a replacement whose write committed but response failed', async () => {
    const fixture = buildManager('ambiguous-save');
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockImplementationOnce(async (id, patch) => {
        await fixture.save(id, patch);
        throw new Error('response lost');
      });
    await expect(fixture.upsert()).resolves.toMatchObject({ messageId: '200' });
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_message_id).toBe('200');
  });

  it('retries failed deletion from durable cleanup coordinates without sending another replacement', async () => {
    const fixture = buildManager('delete-failure');
    fixture.oldMessage.delete.mockRejectedValueOnce(new Error('missing permission'));
    await expect(fixture.upsert()).rejects.toThrow('cleanup needs attention');
    expect(fixture.settings()).toMatchObject({
      report_instructions_message_id: '200',
      report_instructions_cleanup_message_id: '100',
    });
    // A refreshed form may name the replacement. Cleanup retry still must not repost again.
    await expect(fixture.upsert(true, '200')).resolves.toMatchObject({
      messageId: '200',
    });
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(2);
    expect(fixture.settings().report_instructions_cleanup_message_id).toBeNull();
  });

  it('retries cleanup-state persistence without publishing again after the old panel was removed', async () => {
    const fixture = buildManager('cleanup-save-failure');
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockImplementationOnce(fixture.save)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('database unavailable');
    fixture.channel.messages.fetch.mockRejectedValueOnce({ code: 10008 });
    await fixture.upsert(true, '200');
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
  });

  it('recovers failed persistence across manager instances without duplicate sends', async () => {
    const fixture = buildManager('rollback-failure');
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('Retry setup to recover');
    const retryManager = new ReportInstructionsManager(
      fixture.client as unknown as Client,
      fixture.config as unknown as IConfigService
    );
    await retryManager.upsertReportInstructionsMessage(
      'rollback-failure',
      fixture.channel as unknown as TextChannel,
      {
        repost: true,
        expectedMessageId: '100',
      }
    );
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_message_id).toBe('200');
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
  });

  it('retains both panels when a failed write cannot be verified and recovers on retry', async () => {
    const fixture = buildManager('read-after-save-failure');
    fixture.config.updateServerSettings
      .mockImplementationOnce(fixture.save)
      .mockRejectedValueOnce(new Error('database unavailable'));
    fixture.config.getServerConfig
      .mockResolvedValueOnce({ settings: fixture.settings() })
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('Retry setup to recover');
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    await fixture.upsert();
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent repost requests and makes stale retries reuse the replacement', async () => {
    const fixture = buildManager('concurrent-repost');
    const secondManager = new ReportInstructionsManager(
      fixture.client as unknown as Client,
      fixture.config as unknown as IConfigService
    );
    await Promise.all([
      fixture.upsert(),
      secondManager.upsertReportInstructionsMessage(
        'concurrent-repost',
        fixture.channel as unknown as TextChannel,
        {
          repost: true,
          expectedMessageId: '100',
        }
      ),
    ]);
    await fixture.upsert();
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.settings().report_instructions_message_id).toBe('200');
  });

  it('does not delete a saved message owned by somebody else', async () => {
    const fixture = buildManager('unrelated-message');
    fixture.oldMessage.author.id = 'human';
    await expect(fixture.upsert()).rejects.toThrow('cleanup needs attention');
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_message_id).toBe('200');
  });

  it('does not delete an unrelated bot-owned message', async () => {
    const fixture = buildManager('unrelated-bot-message');
    fixture.oldMessage.embeds[0].title = 'Other instructions';
    await expect(fixture.upsert()).rejects.toThrow('cleanup needs attention');
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
  });

  it('does not recreate an existing panel on a transient fetch error', async () => {
    const fixture = buildManager('transient-fetch');
    fixture.channel.messages.fetch.mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(fixture.upsert(false)).rejects.toThrow('Discord unavailable');
    expect(fixture.channel.send).not.toHaveBeenCalled();
  });
});
