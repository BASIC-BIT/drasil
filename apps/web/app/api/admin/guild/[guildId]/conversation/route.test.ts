import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  guild: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: mocks.session,
  getCurrentDiscordToken: mocks.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: mocks.guild }),
}));
vi.mock('@/lib/conversationDataAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversationDataAdapter')>()),
  readConversationPage: mocks.read,
}));
import { GET } from './route';
const guildId = '100000000000000001';
const request = (query = 'recordKind=case&recordId=case-1&sourceKey=source_message&page=around') =>
  GET(new NextRequest(`https://drasil.example/api/admin/guild/${guildId}/conversation?${query}`), {
    params: Promise.resolve({ guildId }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: '100000000000000004' });
  mocks.token.mockResolvedValue({ accessToken: 'token' });
  mocks.guild.mockResolvedValue({ id: guildId });
  mocks.read.mockResolvedValue({ kind: 'unavailable', reason: 'missing' });
});
it('rejects unauthenticated reads before resolving a source', async () => {
  mocks.session.mockResolvedValue(null);
  expect((await request()).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('rejects guild denial before resolving a source', async () => {
  mocks.guild.mockRejectedValue(new Error('PRIVATE'));
  const response = await request();
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('PRIVATE');
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([
  'recordKind=case&recordId=case-1&sourceKey=source_message&page=before&cursor=https://evil.example',
  'recordKind=case&recordId=case-1&sourceKey=source_message&page=around&channelId=123',
  'recordKind=case&recordId=case-1&sourceKey=source_message&page=around&page=after',
])('rejects malformed query %s', async (query) => {
  expect((await request(query)).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('returns private no-store unavailable without leaking errors', async () => {
  const response = await request();
  expect(await response.json()).toEqual({ kind: 'unavailable', reason: 'missing' });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it('validates result before serialization', async () => {
  mocks.read.mockResolvedValue({ kind: 'available', messages: [{ content: 'PRIVATE' }] });
  const response = await request();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('PRIVATE');
});
