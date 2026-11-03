import { ReportMemberDirectory } from '../../services/ReportMemberDirectory';
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

describe('deterministic identity resolution', () => {
  function setup(subjectOverrides: Partial<import('@drasil/application').ReportSubjectClues> = {}) {
    const list = jest.fn();
    const fetch = jest.fn();
    const search = jest.fn().mockResolvedValue(new Map());
    const guild = {
      id: '333333333333333333',
      members: { list, fetch, search },
      channels: { fetch: jest.fn() },
    } as unknown as Guild;
    const member = buildMember(guild);
    const members = new Map([[member.id, member]]);
    list.mockResolvedValue(members);
    fetch.mockImplementation(async ({ user }: { user: string }) => members.get(user) ?? null);
    const subject: import('@drasil/application').ReportSubjectClues = {
      subjectId: 'target',
      role: 'target',
      readability: 'clear',
      sourceRefs: [
        { evidenceId: 'e1', messageId: 'm1', sourceVersion: 1, role: 'reporter', kind: 'image' },
      ],
      userIds: [],
      usernames: [],
      displayNames: ['Target Global'],
      messageLinks: [],
      uncertainty: [],
      ...subjectOverrides,
    };
    const directory = new ReportMemberDirectory();
    const service = new ReportCandidateService(directory);
    const input = {
      guild,
      reporterId: 'reporter',
      subjects: [subject],
      signal: new AbortController().signal,
    };
    return { service, input, member, members, list, fetch, search, guild, subject, directory };
  }
  it('finds a global display name outside prefix-search results', async () => {
    const { service, input, search, fetch } = setup();
    const outcome = await service.resolveIdentity(input);
    expect(search).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('confirm');
    if (outcome.kind !== 'confirm') throw new Error('Expected confirmation');
    expect(outcome.candidate.matchedFields).toContain('globalName');
    expect(fetch).toHaveBeenCalledWith({ user: USER_ID, force: true, cache: false });
  });
  it.each([
    [{ usernames: [' TARGET-USER '], displayNames: [] }, 'username'],
    [{ displayNames: [' Target   Nick '] }, 'nickname'],
    [{ displayNames: ['Target Nick'] }, 'displayName'],
  ])('matches distinct exact name fields', async (clues, field) => {
    const { service, input } = setup(clues);
    const outcome = await service.resolveIdentity(input);
    expect(outcome.kind).toBe('confirm');
    if (outcome.kind === 'confirm') expect(outcome.candidate.matchedFields).toContain(field);
  });
  it('normalizes canonical Unicode but preserves distinct confusables', async () => {
    const { service, input, member } = setup({ displayNames: ['Cafe\u0301'] });
    member.user.globalName = 'Café';
    expect((await service.resolveIdentity(input)).kind).toBe('confirm');
    input.subjects[0].displayNames = ['Cаfé']; // Cyrillic a remains distinct.
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'no_match',
    });
  });
  it('retains every duplicate name match beyond five', async () => {
    const { service, input, members, guild } = setup();
    for (let i = 0; i < 7; i++) {
      const member = buildMember(guild, String(i));
      members.set(member.id, member);
    }
    const outcome = await service.resolveIdentity(input);
    expect(outcome).toMatchObject({ kind: 'admin_review', reason: 'ambiguous' });
    if (outcome.kind === 'admin_review') expect(outcome.candidates).toHaveLength(8);
  });
  it.each(['reporter', 'bot'])('excludes the %s', async (kind) => {
    const { service, input, member } = setup();
    if (kind === 'reporter') input.reporterId = member.id;
    else member.user.bot = true;
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'no_match',
      candidates: [],
    });
  });
  it('hands uncertain reading to admins even with one apparent match', async () => {
    const { service, input } = setup({ readability: 'uncertain' });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'uncertain_text',
    });
  });
  it('does not turn listing failure into no match or confirmation', async () => {
    const { service, input, list } = setup();
    list.mockRejectedValue({ code: 50013 });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'lookup_failure',
      coverage: { kind: 'unavailable', reason: 'permissions' },
    });
  });
  it('validates an explicit ID without a scan', async () => {
    const { service, input, list } = setup({ userIds: [USER_ID], displayNames: [] });
    expect((await service.resolveIdentity(input)).kind).toBe('confirm');
    expect(list).not.toHaveBeenCalled();
  });
  it('retains conflicts between explicit anchors', async () => {
    const { service, input, members, guild } = setup({
      userIds: [USER_ID, OTHER_USER_ID],
      displayNames: [],
    });
    members.set(OTHER_USER_ID, buildMember(guild, OTHER_USER_ID));
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'conflicting_anchors',
    });
  });
  it('retains an unresolved target beside a clear ID target', async () => {
    const { service, input, subject } = setup({ userIds: [USER_ID], displayNames: [] });
    input.subjects.push({
      ...subject,
      subjectId: 'second',
      userIds: [],
      displayNames: ['Missing'],
    });
    expect((await service.resolveIdentity(input)).kind).toBe('admin_review');
  });
  it('merges same-account target associations but ignores clearly labeled bystanders', async () => {
    const { service, input, subject } = setup();
    input.subjects.push({ ...subject, subjectId: 'second', userIds: [USER_ID], displayNames: [] });
    input.subjects.push({
      ...subject,
      subjectId: 'bystander',
      role: 'other',
      displayNames: ['Bystander'],
    });
    const outcome = await service.resolveIdentity(input);
    expect(outcome.kind).toBe('confirm');
    if (outcome.kind === 'confirm')
      expect(outcome.candidate.subjectMatches.map((match) => match.subjectId).sort()).toEqual([
        'second',
        'target',
      ]);
  });
  it('does not ignore unknown subjects', async () => {
    const { service, input, subject } = setup();
    input.subjects.push({ ...subject, subjectId: 'unknown', role: 'unknown' });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'uncertain_text',
    });
  });
  it.each(['renamed', 'left'])(
    'revalidates current membership and relied-on names (%s)',
    async (change) => {
      const { service, input, fetch, member } = setup();
      if (change === 'left') fetch.mockRejectedValue({ code: 10007 });
      else fetch.mockResolvedValue({ ...member, user: { ...member.user, globalName: 'Renamed' } });
      expect((await service.resolveIdentity(input)).kind).toBe('admin_review');
    }
  );
  it('finds the exact account after more than five prefix-only members', async () => {
    const { service, input, members, guild } = setup({
      usernames: ['target-user'],
      displayNames: [],
    });
    const target = members.get(USER_ID)!;
    members.clear();
    for (let i = 0; i < 6; i++) {
      const member = buildMember(guild, String(i));
      member.user.username = `target-user-${i}`;
      members.set(member.id, member);
    }
    members.set(target.id, target);
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'confirm',
      candidate: { discordUserId: USER_ID },
    });
  });
  it('refuses name-only confirmation under partial coverage', async () => {
    const { service, input, directory } = setup();
    const snapshot = await directory.snapshot(input.guild, input.signal);
    jest.spyOn(directory, 'snapshot').mockResolvedValue({
      ...snapshot,
      coverage: {
        kind: 'partial',
        reason: 'page_limit',
        scannedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        memberCount: 10000,
      },
    });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'incomplete_coverage',
    });
  });
  it('rejects a directory invalidated during final membership revalidation', async () => {
    const { service, input, directory, fetch, member } = setup();
    fetch.mockImplementation(async () => {
      directory.invalidate(input.guild.id);
      return member;
    });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'incomplete_coverage',
    });
  });
  it('preserves name contradictions beside an explicit anchor', async () => {
    const { service, input, members, guild } = setup({
      userIds: [USER_ID],
      displayNames: ['Other Name'],
    });
    const other = buildMember(guild, OTHER_USER_ID);
    other.user.globalName = 'Other Name';
    members.set(other.id, other);
    const outcome = await service.resolveIdentity(input);
    expect(outcome).toMatchObject({ kind: 'admin_review', reason: 'conflicting_anchors' });
    if (outcome.kind === 'admin_review') expect(outcome.candidates).toHaveLength(2);
  });
  it('validates a same-server linked author without directory coverage', async () => {
    const { service, input, guild, list } = setup({
      displayNames: [],
      messageLinks: [
        'https://discord.com/channels/333333333333333333/444444444444444444/555555555555555555',
      ],
    });
    (guild.channels.fetch as jest.Mock).mockResolvedValue({
      messages: { fetch: jest.fn().mockResolvedValue({ author: { id: USER_ID } }) },
    });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'confirm',
      coverage: { kind: 'not_required', reason: 'validated_anchor' },
      candidate: { matchedFields: ['messageAuthor'] },
    });
    expect(list).not.toHaveBeenCalled();
  });
  it('does not ignore a foreign-server link beside a valid ID', async () => {
    const { service, input } = setup({
      userIds: [USER_ID],
      displayNames: [],
      messageLinks: [
        'https://discord.com/channels/666666666666666666/444444444444444444/555555555555555555',
      ],
    });
    expect(await service.resolveIdentity(input)).toMatchObject({
      kind: 'admin_review',
      reason: 'lookup_failure',
    });
  });
  it('rejects a formerly matched name field even when the name moves to a different field', async () => {
    const { service, input, fetch, member } = setup();
    fetch.mockResolvedValue({
      ...member,
      nickname: 'Target Global',
      user: { ...member.user, globalName: 'Changed' },
    });
    expect((await service.resolveIdentity(input)).kind).toBe('admin_review');
  });
  it('does not dispatch lookups after cancellation', async () => {
    const { service, input, fetch } = setup({ userIds: [USER_ID], displayNames: [] });
    const controller = new AbortController();
    controller.abort();
    input.signal = controller.signal;
    expect((await service.resolveIdentity(input)).kind).toBe('admin_review');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not fetch a linked message if cancellation occurs while fetching its channel', async () => {
    const { service, input, guild } = setup({
      displayNames: [],
      messageLinks: [
        'https://discord.com/channels/333333333333333333/444444444444444444/555555555555555555',
      ],
    });
    const controller = new AbortController();
    input.signal = controller.signal;
    const fetchMessage = jest.fn().mockResolvedValue({ author: { id: USER_ID } });
    (guild.channels.fetch as jest.Mock).mockImplementation(async () => {
      controller.abort();
      return { messages: { fetch: fetchMessage } };
    });
    expect((await service.resolveIdentity(input)).kind).toBe('admin_review');
    expect(fetchMessage).not.toHaveBeenCalled();
  });
});
