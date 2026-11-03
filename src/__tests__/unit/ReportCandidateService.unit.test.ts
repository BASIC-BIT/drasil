import { Guild, GuildMember, Message } from 'discord.js';
import { ReportCandidateService } from '../../services/ReportCandidateService';

const USER_ID = '111111111111111111';
const OTHER_USER_ID = '222222222222222222';

function buildMember(guild: Guild, userId = USER_ID): GuildMember {
  return {
    id: userId,
    guild,
    displayName: 'Target Display',
    nickname: 'Target Nick',
    displayAvatarURL: jest.fn().mockReturnValue('https://cdn.example/avatar.png'),
    user: {
      id: userId,
      username: 'target-user',
      globalName: 'Target Global',
    },
  } as unknown as GuildMember;
}

describe('ReportCandidateService', () => {
  it('extracts explicit platform-backed candidate signals', () => {
    const service = new ReportCandidateService();

    const signals = service.extractCandidateSignals(
      `Please check <@${USER_ID}>. user id: ${OTHER_USER_ID} https://discord.com/channels/333333333333333333/444444444444444444/555555555555555555`
    );

    expect(signals.mentions).toEqual([USER_ID]);
    expect(signals.explicitUserIds).toEqual([OTHER_USER_ID]);
    expect(signals.messageLinks).toEqual([
      {
        guildId: '333333333333333333',
        channelId: '444444444444444444',
        messageId: '555555555555555555',
        url: 'https://discord.com/channels/333333333333333333/444444444444444444/555555555555555555',
      },
    ]);
  });

  it('extracts standalone Discord snowflakes without treating message-link IDs as user IDs', () => {
    const service = new ReportCandidateService();

    const signals = service.extractCandidateSignals(
      `Please check ${USER_ID} https://discord.com/channels/333333333333333333/444444444444444444/555555555555555555`
    );

    expect(signals.explicitUserIds).toEqual([USER_ID]);
    expect(signals.messageLinks).toHaveLength(1);
  });

  it('resolves mentions to current-server candidates without requiring confirmation', async () => {
    const service = new ReportCandidateService();
    const guild = {
      id: '333333333333333333',
      members: { fetch: jest.fn() },
      channels: { fetch: jest.fn() },
    } as unknown as Guild;
    const member = buildMember(guild);
    (guild.members.fetch as jest.Mock).mockResolvedValue(member);
    const message = {
      content: `<@${USER_ID}>`,
      guild,
    } as unknown as Message;

    const candidates = await service.resolvePlatformBackedCandidates(message);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      discordUserId: USER_ID,
      confirmationRequired: false,
      platformBackedEvidence: ['explicit Discord ID or mention'],
    });
  });

  it('resolves same-guild message links to the linked message author', async () => {
    const service = new ReportCandidateService();
    const guild = {
      id: '333333333333333333',
      members: { fetch: jest.fn() },
      channels: { fetch: jest.fn() },
    } as unknown as Guild;
    const member = buildMember(guild, OTHER_USER_ID);
    (guild.members.fetch as jest.Mock).mockResolvedValue(member);
    (guild.channels.fetch as jest.Mock).mockResolvedValue({
      messages: {
        fetch: jest.fn().mockResolvedValue({ author: { id: OTHER_USER_ID } }),
      },
    });
    const message = {
      content:
        'https://discord.com/channels/333333333333333333/444444444444444444/555555555555555555',
      guild,
    } as unknown as Message;

    const candidates = await service.resolvePlatformBackedCandidates(message);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      discordUserId: OTHER_USER_ID,
      platformBackedEvidence: ['validated Discord message link'],
      confirmationRequired: false,
    });
  });

  it('finds an exact name after the first five prefix matches', async () => {
    const service = new ReportCandidateService();
    const members: GuildMember[] = [];
    const lookup = jest.fn(
      async ({ limit }: { limit: number }) =>
        new Map(members.slice(0, limit).map((member) => [member.id, member]))
    );
    const guild = {
      id: '333333333333333333',
      members: { fetch: lookup, search: lookup },
    } as unknown as Guild;
    for (let i = 0; i < 5; i++) {
      const member = buildMember(guild, `${i}`);
      member.user.username = `target-user-${i}`;
      members.push(member);
    }
    members.push(buildMember(guild));

    const candidates = await service.searchMembersByName(guild, 'target-user');

    expect(candidates.map((candidate) => candidate.discordUserId)).toEqual([USER_ID]);
    expect(candidates[0].confirmationRequired).toBe(true);
  });

  it('uses the username-and-nickname search for a nickname-only match', async () => {
    const service = new ReportCandidateService();
    const search = jest.fn();
    const guild = {
      id: '333333333333333333',
      members: { fetch: jest.fn().mockResolvedValue(new Map()), search },
    } as unknown as Guild;
    search.mockResolvedValue(new Map([[USER_ID, buildMember(guild)]]));

    const candidates = await service.searchMembersByName(guild, 'Target Nick');

    expect(candidates.map((candidate) => candidate.discordUserId)).toEqual([USER_ID]);
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith({ query: 'Target Nick', limit: 1000 });
  });

  it('limits exact candidates after discarding prefix-only matches', async () => {
    const service = new ReportCandidateService();
    const search = jest.fn();
    const guild = { id: '333333333333333333', members: { search } } as unknown as Guild;
    const members = [
      buildMember(guild, 'prefix-only'),
      buildMember(guild),
      buildMember(guild, OTHER_USER_ID),
    ];
    members[0].nickname = 'Target Nick Extra';
    search.mockResolvedValue(new Map(members.map((member) => [member.id, member])));

    const candidates = await service.searchMembersByName(guild, 'Target Nick', 1);

    expect(candidates.map((candidate) => candidate.discordUserId)).toEqual([USER_ID]);
  });

  it('marks name-search candidates as requiring human confirmation', async () => {
    const service = new ReportCandidateService();
    const guild = {
      id: '333333333333333333',
      members: { search: jest.fn() },
    } as unknown as Guild;
    const member = buildMember(guild);
    (guild.members.search as jest.Mock).mockResolvedValue(new Map([[USER_ID, member]]));

    const candidates = await service.searchMembersByName(guild, 'Target Nick');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      discordUserId: USER_ID,
      confirmationRequired: true,
      platformBackedEvidence: [],
    });
  });
});
