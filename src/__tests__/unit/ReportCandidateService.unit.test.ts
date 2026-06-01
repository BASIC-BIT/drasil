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

  it('marks name-search candidates as requiring human confirmation', async () => {
    const service = new ReportCandidateService();
    const guild = {
      id: '333333333333333333',
      members: { fetch: jest.fn() },
    } as unknown as Guild;
    const member = buildMember(guild);
    (guild.members.fetch as jest.Mock).mockResolvedValue(new Map([[USER_ID, member]]));

    const candidates = await service.searchMembersByName(guild, 'Target Nick');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      discordUserId: USER_ID,
      confirmationRequired: true,
      platformBackedEvidence: [],
    });
  });
});
