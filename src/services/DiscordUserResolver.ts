import type { Client } from 'discord.js';

export type UserResolution =
  | { status: 'found'; userId: string }
  | { status: 'not_found' }
  | { status: 'ambiguous' };

export class DiscordUserResolver {
  public constructor(private readonly client: Client) {}

  public async resolveGuildUserId(guildId: string, userInput: string): Promise<UserResolution> {
    const trimmedInput = userInput.trim();
    const mentionMatch = trimmedInput.match(/^<@!?(\d{17,19})>$/);
    const directUserId =
      mentionMatch?.[1] ?? (/^\d{17,19}$/.test(trimmedInput) ? trimmedInput : null);

    if (directUserId) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        await guild.members.fetch(directUserId);
        return { status: 'found', userId: directUserId };
      } catch {
        return { status: 'not_found' };
      }
    }

    const normalizedInput = trimmedInput.replace(/^@/, '').toLowerCase();
    if (!normalizedInput) {
      return { status: 'not_found' };
    }

    const tagMatch = trimmedInput.replace(/^@/, '').match(/^(.+)#(\d{4})$/);

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const members = await guild.members.search({
        query: tagMatch ? tagMatch[1] : normalizedInput,
        limit: 100,
      });
      const candidates = Array.from(members.values());

      if (tagMatch) {
        const foundMember = candidates.find(
          (member) =>
            member.user.username.toLowerCase() === tagMatch[1].toLowerCase() &&
            member.user.discriminator === tagMatch[2]
        );
        return foundMember ? { status: 'found', userId: foundMember.id } : { status: 'not_found' };
      }

      const usernameMatch = candidates.find((member) =>
        [member.user.username, member.user.tag]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase() === normalizedInput)
      );
      if (usernameMatch) {
        return { status: 'found', userId: usernameMatch.id };
      }

      const nonUniqueMatches = candidates.filter((member) => {
        const names = [member.user.globalName, member.displayName, member.nickname].filter(
          (value): value is string => Boolean(value)
        );

        return names.some((value) => value.toLowerCase() === normalizedInput);
      });

      if (nonUniqueMatches.length > 1) {
        return { status: 'ambiguous' };
      }

      if (nonUniqueMatches.length === 1) {
        return { status: 'found', userId: nonUniqueMatches[0].id };
      }

      return { status: 'not_found' };
    } catch (error) {
      console.error(`[DiscordUserResolver] Error fetching members for user resolution: ${error}`);
      return { status: 'not_found' };
    }
  }
}
