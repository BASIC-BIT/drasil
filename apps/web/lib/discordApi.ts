import { readOptionalEnv, requireEnv } from './env';

const DEFAULT_DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

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
    throw new Error(`Discord API request failed with ${response.status}: ${body.slice(0, 200)}`);
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
  const response = await fetch(`${discordApiBaseUrl()}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  return readDiscordJson<DiscordUser>(response);
}

export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuildSummary[]> {
  const response = await fetch(`${discordApiBaseUrl()}/users/@me/guilds`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  return readDiscordJson<DiscordGuildSummary[]>(response);
}

async function fetchBotJson<T>(path: string): Promise<T> {
  const botToken = readOptionalEnv('DRASIL_WEB_BOT_TOKEN') ?? readOptionalEnv('DISCORD_TOKEN');
  if (!botToken) {
    throw new Error(
      'DRASIL_WEB_BOT_TOKEN or DISCORD_TOKEN is required for live setup diagnostics.'
    );
  }
  const response = await fetch(`${discordApiBaseUrl()}${path}`, {
    headers: { authorization: `Bot ${botToken}` },
    cache: 'no-store',
  });
  return readDiscordJson<T>(response);
}

export async function fetchGuildResources(guildId: string): Promise<DiscordGuildResources> {
  const botUser = await fetchBotJson<DiscordUser>('/users/@me');
  const [botMember, roles, channels] = await Promise.all([
    fetchBotJson<DiscordGuildMember>(`/guilds/${guildId}/members/${botUser.id}`),
    fetchBotJson<DiscordRole[]>(`/guilds/${guildId}/roles`),
    fetchBotJson<DiscordChannel[]>(`/guilds/${guildId}/channels`),
  ]);

  return { botUser, botMember, roles, channels };
}
