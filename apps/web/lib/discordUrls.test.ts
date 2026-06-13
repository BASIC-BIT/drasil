import { describe, expect, it } from 'vitest';
import { discordDesktopUrl, discordDesktopUrlFromWebUrl, discordMessageUrl } from './discordUrls';

describe('discordUrls', () => {
  it('builds Discord web message and channel URLs', () => {
    expect(discordMessageUrl('guild-1', 'channel-1', 'message-1')).toBe(
      'https://discord.com/channels/guild-1/channel-1/message-1'
    );
    expect(discordMessageUrl('guild-1', 'channel-1')).toBe(
      'https://discord.com/channels/guild-1/channel-1'
    );
  });

  it('builds Discord desktop app URLs', () => {
    expect(discordDesktopUrl('guild-1', 'channel-1', 'message-1')).toBe(
      'discord://discord.com/channels/guild-1/channel-1/message-1'
    );
    expect(discordDesktopUrl('guild-1', 'channel-1')).toBe(
      'discord://discord.com/channels/guild-1/channel-1'
    );
  });

  it('derives desktop app URLs only from Discord web channel URLs', () => {
    expect(
      discordDesktopUrlFromWebUrl('https://discord.com/channels/guild-1/channel-1/message-1')
    ).toBe('discord://discord.com/channels/guild-1/channel-1/message-1');
    expect(discordDesktopUrlFromWebUrl('https://cdn.discordapp.com/attachment.png')).toBeNull();
    expect(discordDesktopUrlFromWebUrl('not a url')).toBeNull();
  });
});
