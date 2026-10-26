import { fetchDiscordRead } from './discordReadRecovery';
import { readOptionalEnv, requireEnv } from './env';

const DEFAULT_DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_GUILD_PAGE_LIMIT = 200;
const DISCORD_MESSAGE_PAGE_LIMIT = 100;

export class DiscordApiError extends Error {
  public constructor(
    public readonly status: number,
    detail: string
  ) {
    super(`Discord API request failed with ${status}: ${detail.slice(0, 200)}`);
    this.name = 'DiscordApiError';
  }
}

export interface DiscordUser {
  readonly id: string;
  readonly username: string;
  readonly global_name?: string | null;
  readonly avatar?: string | null;
}

export interface DiscordOAuthTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope: string;
}

export interface DiscordGuildSummary {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly owner: boolean;
  readonly permissions: string;
}

export interface DiscordRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: string;
  readonly position: number;
  readonly managed: boolean;
}

export interface DiscordChannel {
  readonly guild_id?: string;
  readonly parent_id?: string | null;
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly permission_overwrites?: readonly {
    readonly id: string;
    readonly type: number;
    readonly allow: string;
    readonly deny: string;
  }[];
}

export interface DiscordGuildMember {
  readonly roles: readonly string[];
  readonly user?: DiscordUser;
}

export interface DiscordMessageAttachment {
  readonly id: string;
  readonly filename?: string;
  readonly url?: string;
  readonly proxy_url?: string;
  readonly content_type?: string;
  readonly size?: number;
}

export interface DiscordMessage {
  readonly id: string;
  readonly channel_id: string;
  readonly content: string;
  readonly timestamp: string;
  readonly author: DiscordUser;
  readonly attachments?: readonly DiscordMessageAttachment[];
}

export interface DiscordGuildResources {
  readonly botUser: DiscordUser;
  readonly botMember: DiscordGuildMember;
  readonly roles: readonly DiscordRole[];
  readonly channels: readonly DiscordChannel[];
}

function discordApiBaseUrl(): string {
  return (readOptionalEnv('DISCORD_API_BASE_URL') ?? DEFAULT_DISCORD_API_BASE_URL).replace(
    /\/+$/,
    ''
  );
}

async function readDiscordJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new DiscordApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export function discordAvatarUrl(user: Pick<DiscordUser, 'id' | 'avatar'>): string | null {
  if (!user.avatar) {
    return null;
  }
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

export async function exchangeDiscordCode(args: {
  code: string;
  redirectUri: string;
}): Promise<DiscordOAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('DISCORD_CLIENT_ID'),
    client_secret: requireEnv('DISCORD_CLIENT_SECRET'),
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
  });

  const response = await fetch(`${discordApiBaseUrl()}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  return readDiscordJson<DiscordOAuthTokenResponse>(response);
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  return fetchDiscordRead(
    new URL(`${discordApiBaseUrl()}/users/@me`),
    { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
    readDiscordJson<DiscordUser>
  );
}

export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuildSummary[]> {
  const guilds: DiscordGuildSummary[] = [];
  let after: string | null = null;

  while (true) {
    const url = new URL(`${discordApiBaseUrl()}/users/@me/guilds`);
    url.searchParams.set('limit', String(DISCORD_GUILD_PAGE_LIMIT));
    if (after) {
      url.searchParams.set('after', after);
    }

    const page = await fetchDiscordRead(
      url,
      { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
      readDiscordJson<DiscordGuildSummary[]>
    );
    guilds.push(...page);
    if (page.length < DISCORD_GUILD_PAGE_LIMIT) {
      return guilds;
    }
    after = page[page.length - 1]?.id ?? null;
    if (!after) {
      return guilds;
    }
  }
}

async function fetchBotJson<T>(path: string): Promise<T> {
  const botToken = readOptionalEnv('DRASIL_WEB_BOT_TOKEN') ?? readOptionalEnv('DISCORD_TOKEN');
  if (!botToken) {
    throw new Error(
      'DRASIL_WEB_BOT_TOKEN or DISCORD_TOKEN is required for live setup diagnostics.'
    );
  }
  return fetchDiscordRead(
    new URL(`${discordApiBaseUrl()}${path}`),
    { headers: { authorization: `Bot ${botToken}` }, cache: 'no-store' },
    readDiscordJson<T>
  );
}

export async function fetchDiscordBotUser(): Promise<DiscordUser> {
  return fetchBotJson<DiscordUser>('/users/@me');
}

export async function deleteBotMessage(channelId: string, messageId: string): Promise<boolean> {
  const botToken = readOptionalEnv('DRASIL_WEB_BOT_TOKEN') ?? readOptionalEnv('DISCORD_TOKEN');
  if (!botToken) {
    throw new Error('DRASIL_WEB_BOT_TOKEN or DISCORD_TOKEN is required for bot message deletion.');
  }

  const response = await fetch(
    `${discordApiBaseUrl()}/channels/${channelId}/messages/${messageId}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bot ${botToken}` },
      cache: 'no-store',
    }
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord API request failed with ${response.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

export async function fetchGuildResources(
  guildId: string,
  knownBotUser?: DiscordUser
): Promise<DiscordGuildResources> {
  const botUser = knownBotUser ?? (await fetchDiscordBotUser());
  const [botMember, roles, channels] = await Promise.all([
    fetchBotJson<DiscordGuildMember>(`/guilds/${guildId}/members/${botUser.id}`),
    fetchBotJson<DiscordRole[]>(`/guilds/${guildId}/roles`),
    fetchBotJson<DiscordChannel[]>(`/guilds/${guildId}/channels`),
  ]);

  return { botUser, botMember, roles, channels };
}

export async function fetchBotMessage(
  channelId: string,
  messageId: string
): Promise<DiscordMessage> {
  return fetchBotJson<DiscordMessage>(`/channels/${channelId}/messages/${messageId}`);
}

export async function fetchBotChannelMessages(
  channelId: string,
  limit = DISCORD_MESSAGE_PAGE_LIMIT
): Promise<DiscordMessage[]> {
  const cappedLimit = Math.max(1, Math.min(limit, 200));
  const messages: DiscordMessage[] = [];
  let before: string | null = null;

  while (messages.length < cappedLimit) {
    const pageLimit = Math.min(DISCORD_MESSAGE_PAGE_LIMIT, cappedLimit - messages.length);
    const path = new URLSearchParams({ limit: String(pageLimit) });
    if (before) {
      path.set('before', before);
    }

    const page = await fetchBotJson<DiscordMessage[]>(
      `/channels/${channelId}/messages?${path.toString()}`
    );
    messages.push(...page);
    if (page.length < pageLimit) {
      break;
    }
    before = page[page.length - 1]?.id ?? null;
    if (!before) {
      break;
    }
  }

  return messages.reverse();
}

export async function fetchDiscordGuild(
  guildId: string
): Promise<{ readonly id: string; readonly owner_id: string; readonly name?: string }> {
  return fetchBotJson(`/guilds/${guildId}`);
}
export async function fetchDiscordGuildMember(
  guildId: string,
  userId: string
): Promise<DiscordGuildMember> {
  return fetchBotJson(`/guilds/${guildId}/members/${userId}`);
}
export async function fetchDiscordGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  assertDiscordId(guildId);
  return fetchBotJson(`/guilds/${guildId}/channels`);
}
export async function fetchDiscordGuildRoles(guildId: string): Promise<DiscordRole[]> {
  return fetchBotJson(`/guilds/${guildId}/roles`);
}

/** Narrow read APIs: callers cannot supply Discord paths or arbitrary URLs. */
export async function fetchDiscordChannel(channelId: string): Promise<DiscordChannel> {
  assertDiscordId(channelId);
  return fetchBotJson(`/channels/${channelId}`);
}
export interface DiscordThreadMember {
  readonly id: string;
  readonly user_id: string;
}
export async function fetchDiscordThreadMember(
  threadId: string,
  userId: string
): Promise<DiscordThreadMember> {
  assertDiscordId(threadId);
  assertDiscordId(userId);
  return fetchBotJson(`/channels/${threadId}/thread-members/${userId}`);
}
export async function fetchBotMessagePage(
  channelId: string,
  limit: number,
  before: string | null
): Promise<DiscordMessage[]> {
  assertDiscordId(channelId);
  if (before) assertDiscordId(before);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid Discord page size.');
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return fetchBotJson(`/channels/${channelId}/messages?${params.toString()}`);
}
function assertDiscordId(id: string): void {
  if (!/^\d{17,20}$/.test(id)) throw new Error('Invalid Discord ID.');
}

/** Exactly one source-centered page. Snapshot callers retain their recent-history API. */
export async function fetchBotChannelMessagePage({
  channelId,
  page,
  limit,
}: {
  channelId: string;
  page: { kind: 'around' | 'before' | 'after'; cursor: string };
  limit: 50;
}): Promise<DiscordMessage[]> {
  assertDiscordId(channelId);
  assertDiscordId(page.cursor);
  if (limit !== 50 || !['around', 'before', 'after'].includes(page.kind))
    throw new Error('Invalid conversation page.');
  const params = new URLSearchParams({ limit: String(limit), [page.kind]: page.cursor });
  const messages = await fetchBotJson<DiscordMessage[]>(
    `/channels/${channelId}/messages?${params.toString()}`
  );
  if (!Array.isArray(messages) || messages.length > limit)
    throw new Error('Invalid conversation page.');
  return messages;
}
