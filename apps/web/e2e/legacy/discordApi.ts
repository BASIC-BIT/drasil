// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureGuildResources, fixtureGuilds } from '@/lib/e2eFixtures';
import {
  type DiscordGuildResources,
  type DiscordGuildSummary,
  type DiscordUser,
} from '../../lib/discordApi';
export * from '../../lib/discordApi';

export async function fetchDiscordGuilds(_accessToken: string): Promise<DiscordGuildSummary[]> {
  return fixtureGuilds();
}

export async function fetchDiscordBotUser(): Promise<DiscordUser> {
  return fixtureGuildResources().botUser;
}

export async function fetchGuildResources(
  _guildId: string,
  _knownBotUser?: DiscordUser
): Promise<DiscordGuildResources> {
  return fixtureGuildResources();
}

export async function fetchDiscordGuild(guildId: string) {
  return { id: guildId, owner_id: 'fixture-admin', name: 'Fixture Guild' };
}
export async function fetchDiscordGuildMember(_guildId: string, userId: string) {
  return { user: { id: userId }, roles: [] };
}
export async function fetchDiscordGuildRoles(guildId: string) {
  return [{ id: guildId, name: '@everyone', permissions: '8', position: 0, managed: false }];
}
