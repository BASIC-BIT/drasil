import { Guild, GuildMember, Message, User } from 'discord.js';
import { injectable } from 'inversify';

export interface DiscordMessageLink {
  guildId: string;
  channelId: string;
  messageId: string;
  url: string;
}

export interface CandidateSignalSummary {
  mentions: string[];
  explicitUserIds: string[];
  messageLinks: DiscordMessageLink[];
}

export interface ReportCandidate {
  candidateId: string;
  discordUserId: string;
  serverId: string;
  username: string | null;
  globalName: string | null;
  displayName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  matchReasons: string[];
  confidence: number;
  ambiguityNotes: string[];
  platformBackedEvidence: string[];
  confirmationRequired: boolean;
}

interface MessageFetchChannel {
  messages: {
    fetch(messageId: string): Promise<Message>;
  };
}

export interface IReportCandidateService {
  extractCandidateSignals(content: string): CandidateSignalSummary;
  resolvePlatformBackedCandidates(message: Message): Promise<ReportCandidate[]>;
  searchMembersByName(guild: Guild, searchTerm: string, limit?: number): Promise<ReportCandidate[]>;
}

const DISCORD_MESSAGE_LINK_PATTERN =
  /https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20}|@me)\/(\d{17,20})\/(\d{17,20})/gi;
const DISCORD_MENTION_PATTERN = /<@!?(\d{17,20})>/g;
const EXPLICIT_USER_ID_PATTERN = /\b(?:discord\s*)?(?:user\s*)?id[:#\s]+(\d{17,20})\b/gi;
const STANDALONE_USER_ID_PATTERN = /\b\d{17,20}\b/g;

@injectable()
export class ReportCandidateService implements IReportCandidateService {
  extractCandidateSignals(content: string): CandidateSignalSummary {
    const mentions = new Set<string>();
    const explicitUserIds = new Set<string>();
    const messageLinks: DiscordMessageLink[] = [];

    for (const match of content.matchAll(DISCORD_MENTION_PATTERN)) {
      mentions.add(match[1]);
    }

    for (const match of content.matchAll(EXPLICIT_USER_ID_PATTERN)) {
      explicitUserIds.add(match[1]);
    }

    const contentWithoutStructuredIds = content
      .replace(DISCORD_MESSAGE_LINK_PATTERN, ' ')
      .replace(DISCORD_MENTION_PATTERN, ' ');
    for (const match of contentWithoutStructuredIds.matchAll(STANDALONE_USER_ID_PATTERN)) {
      explicitUserIds.add(match[0]);
    }

    for (const match of content.matchAll(DISCORD_MESSAGE_LINK_PATTERN)) {
      messageLinks.push({
        guildId: match[1],
        channelId: match[2],
        messageId: match[3],
        url: match[0],
      });
    }

    return {
      mentions: [...mentions],
      explicitUserIds: [...explicitUserIds],
      messageLinks,
    };
  }

  async resolvePlatformBackedCandidates(message: Message): Promise<ReportCandidate[]> {
    if (!message.guild) {
      return [];
    }

    const signals = this.extractCandidateSignals(message.content);
    const candidates = new Map<string, ReportCandidate>();

    for (const userId of [...signals.mentions, ...signals.explicitUserIds]) {
      const member = await this.fetchGuildMember(message.guild, userId);
      if (!member) {
        continue;
      }

      this.mergeCandidate(
        candidates,
        this.buildCandidate(member, 'explicit Discord ID or mention')
      );
    }

    for (const link of signals.messageLinks) {
      const linkedMessage = await this.fetchLinkedMessage(message.guild, link);
      if (!linkedMessage) {
        continue;
      }

      const member = await this.fetchGuildMember(message.guild, linkedMessage.author.id);
      if (!member) {
        continue;
      }

      this.mergeCandidate(
        candidates,
        this.buildCandidate(member, 'validated Discord message link')
      );
    }

    return [...candidates.values()];
  }

  async searchMembersByName(
    guild: Guild,
    searchTerm: string,
    limit: number = 5
  ): Promise<ReportCandidate[]> {
    const normalizedSearchTerm = normalize(searchTerm);
    if (!normalizedSearchTerm) {
      return [];
    }

    const fetchedMembers = await guild.members
      .fetch({ query: searchTerm, limit })
      .catch((error) => {
        console.warn(`Failed to search report candidate members in guild ${guild.id}:`, error);
        return null;
      });

    if (!fetchedMembers) {
      return [];
    }

    return [...fetchedMembers.values()]
      .filter((member) => this.memberMatchesName(member, normalizedSearchTerm))
      .map((member) => ({
        ...this.buildCandidate(member, 'current-server name search'),
        confidence: 0.55,
        ambiguityNotes: ['Name/display-name matches require human confirmation.'],
        platformBackedEvidence: [],
        confirmationRequired: true,
      }));
  }

  private async fetchGuildMember(guild: Guild, userId: string): Promise<GuildMember | null> {
    return guild.members.fetch(userId).catch(() => null);
  }

  private async fetchLinkedMessage(
    guild: Guild,
    link: DiscordMessageLink
  ): Promise<Message | null> {
    if (link.guildId !== guild.id) {
      return null;
    }

    const channel = await guild.channels.fetch(link.channelId).catch(() => null);
    if (!hasMessageFetch(channel)) {
      return null;
    }

    return channel.messages.fetch(link.messageId).catch(() => null);
  }

  private buildCandidate(member: GuildMember, reason: string): ReportCandidate {
    const user = member.user as User & { globalName?: string | null };
    const avatarUrl =
      typeof member.displayAvatarURL === 'function' ? member.displayAvatarURL() : null;

    return {
      candidateId: `${member.guild.id}:${member.id}`,
      discordUserId: member.id,
      serverId: member.guild.id,
      username: user.username,
      globalName: user.globalName ?? null,
      displayName: member.displayName,
      nickname: member.nickname ?? null,
      avatarUrl,
      matchReasons: [reason],
      confidence: 0.95,
      ambiguityNotes: [],
      platformBackedEvidence: [reason],
      confirmationRequired: false,
    };
  }

  private mergeCandidate(
    candidates: Map<string, ReportCandidate>,
    candidate: ReportCandidate
  ): void {
    const existing = candidates.get(candidate.discordUserId);
    if (!existing) {
      candidates.set(candidate.discordUserId, candidate);
      return;
    }

    existing.matchReasons = [...new Set([...existing.matchReasons, ...candidate.matchReasons])];
    existing.platformBackedEvidence = [
      ...new Set([...existing.platformBackedEvidence, ...candidate.platformBackedEvidence]),
    ];
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
  }

  private memberMatchesName(member: GuildMember, normalizedSearchTerm: string): boolean {
    const user = member.user as User & { globalName?: string | null };
    return [member.displayName, member.nickname, user.username, user.globalName]
      .map((value) => normalize(value))
      .some((value) => value === normalizedSearchTerm);
  }
}

function hasMessageFetch(channel: unknown): channel is MessageFetchChannel {
  const candidate = channel as Partial<MessageFetchChannel> | null;
  return typeof candidate?.messages?.fetch === 'function';
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}
