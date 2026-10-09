import { Client, Collection, Message, TextChannel } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import { ReportInstructionsManager } from '../../controllers/ReportInstructionsManager';
import { ServerSettings } from '../../repositories/types';

function buildManager(guildId: string) {
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
      return new Collection<string, Message>();
    }
    return id === '100' ? oldMessage : newMessage;
  });
  const channel = {
    id: 'channel',
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
  it('recovers an untracked newer panel from channel history after a restart', async () => {
    const fixture = buildManager('restart-recovery');
    fixture.channel.messages.fetch.mockImplementationOnce(
      async () =>
        new Collection([
          ['200', fixture.newMessage as unknown as Message],
          ['100', fixture.oldMessage as unknown as Message],
        ])
    );
    await expect(fixture.upsert()).resolves.toEqual({ action: 'reposted', messageId: '200' });
    expect(fixture.channel.send).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_message_id).toBe('200');
    expect(fixture.oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
  });

  it('searches past a full page of newer unrelated messages for a replacement', async () => {
    const fixture = buildManager('paginated-recovery');
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
    fixture.config.updateServerSettings.mockRejectedValueOnce(new Error('database unavailable'));
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
    expect(fixture.config.updateServerSettings).toHaveBeenNthCalledWith(1, 'repost-success', {
      report_instructions_channel_id: 'channel',
      report_instructions_message_id: '200',
      report_instructions_cleanup_channel_id: 'channel',
      report_instructions_cleanup_message_id: '100',
    });
    expect(fixture.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.config.updateServerSettings.mock.invocationCallOrder[0]
    );
    expect(fixture.config.updateServerSettings.mock.invocationCallOrder[0]).toBeLessThan(
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
    expect(fixture.config.updateServerSettings).not.toHaveBeenCalled();
    expect(fixture.oldMessage.delete).not.toHaveBeenCalled();
    expect(fixture.settings().report_instructions_message_id).toBe('100');
  });

  it('retains the replacement when persistence fails and recovers it without another send', async () => {
    const fixture = buildManager('save-failure');
    fixture.config.updateServerSettings.mockRejectedValueOnce(new Error('database unavailable'));
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
    fixture.config.updateServerSettings.mockImplementationOnce(async (id, patch) => {
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
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fixture.upsert()).rejects.toThrow('database unavailable');
    fixture.channel.messages.fetch.mockRejectedValueOnce({ code: 10008 });
    await fixture.upsert(true, '200');
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(fixture.newMessage.delete).not.toHaveBeenCalled();
  });

  it('recovers failed persistence across manager instances without duplicate sends', async () => {
    const fixture = buildManager('rollback-failure');
    fixture.config.updateServerSettings.mockRejectedValueOnce(new Error('database unavailable'));
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
    fixture.config.updateServerSettings.mockRejectedValueOnce(new Error('database unavailable'));
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
