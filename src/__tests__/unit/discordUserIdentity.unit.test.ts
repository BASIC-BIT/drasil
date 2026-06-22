import { formatDiscordUserIdentity, formatInlineIdentifier } from '../../utils/discordUserIdentity';

describe('discordUserIdentity (unit)', () => {
  it('formats a member with mention, snowflake, and stable text identifiers', () => {
    expect(
      formatDiscordUserIdentity({
        id: '123456789012345678',
        nickname: 'Server Nick',
        user: {
          id: '123456789012345678',
          username: 'discord.name',
          globalName: 'Display Name',
        },
      })
    ).toBe(
      '<@123456789012345678> (ID: `123456789012345678`; Discord username: `discord.name`; Display name: `Display Name`; Server nickname: `Server Nick`)'
    );
  });

  it('can omit snowflakes for reporter-style labels', () => {
    expect(
      formatDiscordUserIdentity(
        {
          id: '123456789012345678',
          user: { username: 'reporter' },
        },
        { includeSnowflake: false }
      )
    ).toBe('<@123456789012345678> (Discord username: `reporter`)');
  });

  it('keeps inline-code formatting intact when names contain backticks', () => {
    expect(formatInlineIdentifier('name`with`ticks')).toBe("`name'with'ticks`");
  });
});
