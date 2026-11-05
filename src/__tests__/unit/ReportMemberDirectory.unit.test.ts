import { Guild, GuildMember } from 'discord.js';
import { ReportMemberDirectory } from '../../services/ReportMemberDirectory';

function member(id: string): GuildMember {
  return {
    id,
    user: { username: `user-${id}`, globalName: 'Global', bot: false },
    nickname: 'Nick',
  } as GuildMember;
}
function setup() {
  const list = jest.fn();
  const guild = { id: 'guild', members: { list } } as unknown as Guild;
  return {
    list,
    guild,
    directory: new ReportMemberDirectory(),
    signal: new AbortController().signal,
  };
}

describe('ReportMemberDirectory', () => {
  it('lists complete REST coverage with minimal copied names', async () => {
    const { list, guild, directory, signal } = setup();
    list.mockResolvedValue(new Map([['1', member('1')]]));
    const snapshot = await directory.snapshot(guild, signal);
    expect(snapshot.coverage.kind).toBe('complete');
    expect(snapshot.members).toEqual([
      { id: '1', username: 'user-1', globalName: 'Global', nickname: 'Nick', displayName: 'Nick' },
    ]);
    expect(list).toHaveBeenCalledWith({ limit: 1000, cache: false });
  });
});

describe('bounded scans', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it('paginates with the last snowflake and never infers completeness at ten full pages', async () => {
    const { list, guild, directory, signal } = setup();
    const page = new Map(
      Array.from({ length: 1000 }, (_, i) => [String(i + 1), member(String(i + 1))])
    );
    list.mockResolvedValueOnce(page).mockResolvedValueOnce(new Map());
    expect((await directory.snapshot(guild, signal)).coverage.kind).toBe('complete');
    expect(list.mock.calls[1][0]).toEqual({ limit: 1000, cache: false, after: '1000' });
    directory.invalidate();
    list.mockImplementation(
      async ({ after }: { after?: string }) =>
        new Map(
          Array.from({ length: 1000 }, (_, i) => {
            const id = String(Number(after ?? 0) + i + 1);
            return [id, member(id)];
          })
        )
    );
    const result = await directory.snapshot(guild, signal);
    expect(result.coverage).toMatchObject({
      kind: 'partial',
      reason: 'page_limit',
      memberCount: 10000,
    });
    expect(list).toHaveBeenCalledTimes(12);
  });
  it('coalesces scans and expires complete coverage after five minutes', async () => {
    const { list, guild, directory, signal } = setup();
    list.mockResolvedValue(new Map([['1', member('1')]]));
    await Promise.all([directory.snapshot(guild, signal), directory.snapshot(guild, signal)]);
    await directory.snapshot(guild, signal);
    expect(list).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300000);
    await directory.snapshot(guild, signal);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('ends a hung scan after fifteen seconds and ignores late settlement', async () => {
    const { list, guild, directory, signal } = setup();
    // eslint-disable-next-line no-unused-vars -- Function type parameter, not a runtime variable.
    let finish!: (value: Map<string, GuildMember>) => void;
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = directory.snapshot(guild, signal);
    await jest.advanceTimersByTimeAsync(15000);
    expect((await pending).coverage).toMatchObject({ kind: 'partial', reason: 'deadline' });
    await directory.snapshot(guild, signal);
    await directory.snapshot(guild, signal);
    expect(list).toHaveBeenCalledTimes(1);
    finish(new Map([['1', member('1')]]));
    await Promise.resolve();
    await Promise.resolve();
    list.mockResolvedValue(new Map());
    expect((await directory.snapshot(guild, signal)).members).toEqual([]);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it.each(['guild', undefined])(
    'invalidates in-flight user updates or removals (%s)',
    async (guildId) => {
      const { list, guild, directory, signal } = setup();
      // eslint-disable-next-line no-unused-vars -- Function type parameter, not a runtime variable.
      let finish!: (value: Map<string, GuildMember>) => void;
      list.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const pending = directory.snapshot(guild, signal);
      directory.invalidate(guildId);
      finish(new Map([['1', member('1')]]));
      expect((await pending).coverage).toMatchObject({ kind: 'partial', reason: 'interrupted' });
      list.mockResolvedValue(new Map());
      expect((await directory.snapshot(guild, signal)).members).toEqual([]);
      expect(list).toHaveBeenCalledTimes(2);
    }
  );
  it('returns interrupted coverage for an aborted waiter without cancelling another waiter', async () => {
    const { list, guild, directory, signal } = setup();
    // eslint-disable-next-line no-unused-vars -- Function type parameter, not a runtime variable.
    let finish!: (value: Map<string, GuildMember>) => void;
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const controller = new AbortController();
    const cancelled = directory.snapshot(guild, controller.signal);
    const other = directory.snapshot(guild, signal);
    controller.abort();
    expect((await cancelled).coverage).toMatchObject({ kind: 'partial', reason: 'interrupted' });
    finish(new Map());
    expect((await other).coverage.kind).toBe('complete');
  });
  it.each([
    [{ code: 50013 }, 'permissions'],
    [{ status: 429 }, 'rate_limited'],
    [new Error('offline'), 'transport'],
  ])('reports lookup failures', async (error, reason) => {
    const { list, guild, directory, signal } = setup();
    list.mockRejectedValue(error);
    expect((await directory.snapshot(guild, signal)).coverage).toEqual({
      kind: 'unavailable',
      reason,
    });
  });
});
