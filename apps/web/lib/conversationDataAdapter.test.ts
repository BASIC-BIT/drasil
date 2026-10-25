import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  page: vi.fn(),
  case: vi.fn(),
  report: vi.fn(),
  channel: vi.fn(),
  message: vi.fn(),
}));
vi.mock('./conversationAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./conversationAccess')>()),
  assertConversationAccess: mocks.access,
}));
vi.mock('./activeCaseDataAdapter', () => ({
  createActiveCaseDataAdapter: () => ({ getCaseDetail: mocks.case }),
}));
vi.mock('./reportDetailDataAdapter', () => ({
  createReportDetailDataAdapter: () => ({ getReportDetail: mocks.report }),
}));
vi.mock('./discordApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discordApi')>()),
  fetchBotChannelMessagePage: mocks.page,
  fetchDiscordChannel: mocks.channel,
  fetchBotMessage: mocks.message,
}));
import { readConversationPage, conversationQuerySchema } from './conversationDataAdapter';
import { ConversationAccessError } from './conversationAccess';
const guildId = '100000000000000001',
  channelId = '100000000000000002',
  messageId = '100000000000000003';
const query = {
  recordKind: 'case' as const,
  recordId: 'case-1',
  sourceKey: 'source_message',
  page: { kind: 'around' as const },
};
const read = () => readConversationPage({ guildId, actorId: '100000000000000004', query });
const raw = (id = messageId) => ({
  id,
  channel_id: channelId,
  content: 'COMPLETE LIVE BODY',
  timestamp: '2026-01-01T00:00:00.000Z',
  author: { id: '100000000000000006', username: 'actual-author' },
  attachments: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(undefined);
  mocks.channel.mockResolvedValue({ id: channelId, guild_id: guildId, name: 'general' });
  mocks.case.mockResolvedValue({
    id: 'case-1',
    guildId,
    surfaces: [
      {
        kind: 'source_message',
        url: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
      },
    ],
    evidenceItems: [],
  });
  mocks.page.mockResolvedValue([raw()]);
});
it('resolves stored source, authorizes before reading, and maps actual author/time', async () => {
  mocks.page.mockImplementation(async () => {
    expect(mocks.access).toHaveBeenCalledWith({
      guildId,
      actorId: '100000000000000004',
      channelId,
    });
    return [raw()];
  });
  expect(await read()).toMatchObject({
    kind: 'available',
    source: { sourceKey: 'source_message', messageId, channelId },
    messages: [
      {
        authorLabel: 'actual-author (100000000000000006)',
        content: 'COMPLETE LIVE BODY',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  expect(mocks.page).toHaveBeenCalledWith({
    channelId,
    page: { kind: 'around', cursor: messageId },
    limit: 50,
  });
});
it('denied access never reads or serializes Discord bodies', async () => {
  mocks.access.mockRejectedValue(new ConversationAccessError('denied'));
  expect(await read()).toEqual({ kind: 'unavailable', reason: 'denied' });
  expect(mocks.page).not.toHaveBeenCalled();
});
it.each(['different', 'evidence:unrelated'])('rejects unrelated source %s', async (sourceKey) => {
  expect(
    await readConversationPage({
      guildId,
      actorId: '100000000000000004',
      query: { ...query, sourceKey },
    })
  ).toEqual({ kind: 'unavailable', reason: 'missing' });
  expect(mocks.page).not.toHaveBeenCalled();
});
it('rejects cross-guild records without fetching bodies', async () => {
  mocks.case.mockResolvedValue({ id: 'case-1', guildId: 'other', surfaces: [] });
  expect(await read()).toEqual({ kind: 'unavailable', reason: 'missing' });
  expect(mocks.page).not.toHaveBeenCalled();
});
it.each([
  'https://evil.example/channels/100000000000000001/100000000000000002/100000000000000003',
  'https://discord.com/channels/999999999999999999/100000000000000002/100000000000000003',
  'https://discord.com/channels/100000000000000001/100000000000000002/100000000000000003?redirect=evil',
])('rejects untrusted stored source reference %s', async (url) => {
  mocks.case.mockResolvedValue({
    id: 'case-1',
    guildId,
    surfaces: [{ kind: 'source_message', url }],
    evidenceItems: [],
  });
  expect(await read()).toEqual({ kind: 'unavailable', reason: 'missing' });
  expect(mocks.page).not.toHaveBeenCalled();
});
it('validates malformed cursor and refuses arbitrary channel/URL authority', () => {
  expect(
    conversationQuerySchema.safeParse({
      ...query,
      page: { kind: 'before', cursor: 'https://discord.com' },
    }).success
  ).toBe(false);
  expect(conversationQuerySchema.safeParse({ ...query, channelId }).success).toBe(false);
});
it('allows surroundings when the source was deleted', async () => {
  mocks.page.mockResolvedValue([raw('100000000000000005')]);
  expect(await read()).toMatchObject({
    kind: 'available',
    sourcePresent: false,
    messages: [{ id: '100000000000000005' }],
  });
});
it('bounds upstream errors and refuses cross-channel or oversized responses', async () => {
  mocks.page.mockRejectedValue(new Error('PRIVATE_BODY'));
  expect(await read()).toEqual({ kind: 'unavailable', reason: 'upstream' });
  mocks.page.mockResolvedValue([{ ...raw(), channel_id: 'other' }]);
  expect(await read()).toEqual({ kind: 'unavailable', reason: 'upstream' });
  mocks.page.mockResolvedValue(Array.from({ length: 51 }, () => raw()));
  expect(await read()).toEqual({ kind: 'unavailable', reason: 'upstream' });
});
it('resolves report evidence by its actual stored ID', async () => {
  mocks.report.mockResolvedValue({
    id: 'report-1',
    guildId,
    evidence: [
      {
        id: 'real-id',
        sourceMessageUrl: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
      },
    ],
  });
  expect(
    await readConversationPage({
      guildId,
      actorId: '100000000000000004',
      query: {
        ...query,
        recordKind: 'report',
        recordId: 'report-1',
        sourceKey: 'evidence:real-id',
      },
    })
  ).toMatchObject({ kind: 'available' });
});

it('guards live attention replies before any body fetch', async () => {
  const { readAttentionReply } = await import('./conversationDataAdapter');
  mocks.access.mockRejectedValue(new ConversationAccessError('denied'));
  expect(
    await readAttentionReply({ guildId, actorId: '100000000000000004', channelId, messageId })
  ).toEqual({
    kind: 'unavailable',
    sourceUrl: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
  });
  expect(mocks.message).not.toHaveBeenCalled();
});

it('reads live attention with actual identity and rejects cross-channel body results', async () => {
  const { readAttentionReply } = await import('./conversationDataAdapter');
  mocks.message.mockImplementation(async () => {
    expect(mocks.access).toHaveBeenCalled();
    return raw();
  });
  expect(
    await readAttentionReply({ guildId, actorId: '100000000000000004', channelId, messageId })
  ).toMatchObject({
    kind: 'available',
    message: { authorLabel: 'actual-author (100000000000000006)', content: 'COMPLETE LIVE BODY' },
  });
  mocks.message.mockResolvedValue({ ...raw(), channel_id: 'other' });
  expect(
    await readAttentionReply({ guildId, actorId: '100000000000000004', channelId, messageId })
  ).toMatchObject({ kind: 'unavailable' });
});
