import { Guild, GuildMember, Message, User } from 'discord.js';
import { injectable, inject } from 'inversify';
import type {
  ReportAnalysisOutcome,
  ReportIdentityCandidate,
  ReportSubjectClues,
  ReportDirectoryCoverage,
  ReportHandoffReason,
} from '@drasil/application';
import { TYPES } from '../di/symbols';
import {
  IReportMemberDirectory,
  ReportMemberDirectory,
  ReportDirectoryMember,
  reportDirectoryMember,
  awaitReportLookup,
} from './ReportMemberDirectory';

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

export interface ResolveReportIdentityInput {
  guild: Guild;
  reporterId: string;
  subjects: readonly ReportSubjectClues[];
  signal: AbortSignal;
}

export interface IReportCandidateService {
  resolveIdentity(input: ResolveReportIdentityInput): Promise<ReportAnalysisOutcome>;
  extractCandidateSignals(content: string): CandidateSignalSummary;
  resolvePlatformBackedCandidates(message: Message): Promise<ReportCandidate[]>;
  resolveCandidatesFromSignals(
    guild: Guild,
    signals: CandidateSignalSummary,
    reasonPrefix?: string
  ): Promise<ReportCandidate[]>;
  searchMembersByName(guild: Guild, searchTerm: string, limit?: number): Promise<ReportCandidate[]>;
}

const DISCORD_MESSAGE_LINK_PATTERN =
  /https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20}|@me)\/(\d{17,20})\/(\d{17,20})/gi;
const DISCORD_MEMBER_SEARCH_LIMIT = 1000;
const DISCORD_MENTION_PATTERN = /<@!?(\d{17,20})>/g;
const EXPLICIT_USER_ID_PATTERN = /\b(?:discord\s*)?(?:user\s*)?id[:#\s]+(\d{17,20})\b/gi;
const STANDALONE_USER_ID_PATTERN = /\b\d{17,20}\b/g;

@injectable()
export class ReportCandidateService implements IReportCandidateService {
  constructor(
    @inject(TYPES.ReportMemberDirectory)
    private directory: IReportMemberDirectory = new ReportMemberDirectory()
  ) {}

  async resolveIdentity({
    guild,
    reporterId,
    subjects,
    signal,
  }: ResolveReportIdentityInput): Promise<ReportAnalysisOutcome> {
    const candidates = new Map<string, ReportIdentityCandidate>();
    const relevant = subjects.filter(
      (subject) => subject.role === 'target' || subject.role === 'unknown'
    );
    const includedEvidenceIds = [
      ...new Set(subjects.flatMap((subject) => subject.sourceRefs.map((ref) => ref.evidenceId))),
    ];
    const now = new Date().toISOString();
    let coverage: ReportDirectoryCoverage = {
      kind: 'partial',
      reason: 'interrupted',
      scannedAt: now,
      expiresAt: now,
      memberCount: 0,
    };
    const result = (reason: ReportHandoffReason): ReportAnalysisOutcome => ({
      kind: 'admin_review',
      reason,
      candidates: [...candidates.values()],
      coverage,
      includedEvidenceIds,
      excludedEvidenceIds: [],
    });
    let failure = false;
    let conflict = false;
    let unresolved = false;
    let needsDirectory = false;
    const anchors = new Map<string, Map<string, ReportIdentityCandidate['matchedFields']>>();
    const add = (
      member: ReportDirectoryMember,
      subject: ReportSubjectClues,
      fields: ReportIdentityCandidate['matchedFields']
    ): void => {
      if (member.id === reporterId || !fields.length) return;
      const existing = candidates.get(member.id);
      const association = {
        subjectId: subject.subjectId,
        sourceRefs: subject.sourceRefs,
        matchedFields: fields,
      };
      if (existing) {
        const match = existing.subjectMatches.find(
          (match) => match.subjectId === subject.subjectId
        );
        if (match) match.matchedFields = [...new Set([...match.matchedFields, ...fields])];
        else existing.subjectMatches.push(association);
        existing.matchedFields = [...new Set([...existing.matchedFields, ...fields])];
        existing.sourceRefs = [
          ...new Map(
            [...existing.sourceRefs, ...subject.sourceRefs].map((ref) => [JSON.stringify(ref), ref])
          ).values(),
        ];
      } else
        candidates.set(member.id, {
          candidateId: `${guild.id}:${member.id}`,
          discordUserId: member.id,
          serverId: guild.id,
          username: member.username,
          globalName: member.globalName,
          nickname: member.nickname,
          displayName: member.displayName,
          avatarUrl: null,
          subjectMatches: [association],
          sourceRefs: subject.sourceRefs,
          matchedFields: fields,
        });
    };
    try {
      signal.throwIfAborted();
      for (const subject of relevant) {
        const ids = new Map<string, ReportIdentityCandidate['matchedFields']>();
        for (const id of subject.userIds) ids.set(id, ['userId']);
        for (const url of subject.messageLinks) {
          const links = this.extractCandidateSignals(url).messageLinks;
          const link = links.length === 1 && links[0].url === url ? links[0] : undefined;
          if (!link || link.guildId !== guild.id) {
            failure = true;
            continue;
          }
          const channel = await awaitReportLookup(guild.channels.fetch(link.channelId), signal);
          signal.throwIfAborted();
          if (!hasMessageFetch(channel)) {
            failure = true;
            continue;
          }
          const message = await awaitReportLookup(channel.messages.fetch(link.messageId), signal);
          signal.throwIfAborted();
          ids.set(message.author.id, [
            ...new Set([...(ids.get(message.author.id) ?? []), 'messageAuthor' as const]),
          ]);
        }
        anchors.set(subject.subjectId, ids);
        if (ids.size > 1) conflict = true;
        if (!ids.size && (subject.usernames.length || subject.displayNames.length))
          needsDirectory = true;
        if (!ids.size && !subject.usernames.length && !subject.displayNames.length)
          unresolved = true;
        for (const [id, fields] of ids) {
          if (!/^\d{17,20}$/.test(id)) {
            failure = true;
            continue;
          }
          const member = await awaitReportLookup(
            guild.members.fetch({ user: id, force: true, cache: false }),
            signal
          );
          signal.throwIfAborted();
          if (member.user.bot || member.id === reporterId) {
            unresolved = true;
            continue;
          }
          const record = reportDirectoryMember(member);
          add(record, subject, [...fields, ...matchingFields(record, subject)]);
          if (!supportsAllNames(record, subject)) {
            conflict = true;
            needsDirectory = true;
          }
        }
      }
      if (needsDirectory) {
        const snapshot = await this.directory.snapshot(guild, signal);
        coverage = snapshot.coverage;
        for (const subject of relevant) {
          for (const member of snapshot.members)
            add(member, subject, matchingFields(member, subject));
        }
      }
      signal.throwIfAborted();
      if (conflict) return result('conflicting_anchors');
      if (
        relevant.some(
          (subject) =>
            subject.role === 'unknown' ||
            subject.readability !== 'clear' ||
            subject.uncertainty.length
        )
      )
        return result('uncertain_text');
      if (failure) return result('lookup_failure');
      if (needsDirectory && coverage.kind === 'unavailable') return result('lookup_failure');
      if (needsDirectory && coverage.kind !== 'complete') return result('incomplete_coverage');
      if (candidates.size > 1) return result('ambiguous');
      const candidate = candidates.values().next().value;
      if (unresolved || !relevant.length) return result('evidence_unavailable');
      if (!candidate) return result(needsDirectory ? 'no_match' : 'lookup_failure');
      const current = await awaitReportLookup(
        guild.members.fetch({ user: candidate.discordUserId, force: true, cache: false }),
        signal
      );
      signal.throwIfAborted();
      if (current.user.bot || current.id === reporterId) return result('no_match');
      const record = reportDirectoryMember(current);
      for (const subject of relevant) {
        const ids = anchors.get(subject.subjectId);
        if (ids?.size && !ids.has(current.id)) return result('conflicting_anchors');
        if (!ids?.size && !subject.usernames.length && !subject.displayNames.length)
          return result('no_match');
        if (!supportsAllNames(record, subject)) return result('no_match');
        const reliedOnFields =
          candidate.subjectMatches.find((match) => match.subjectId === subject.subjectId)
            ?.matchedFields ?? [];
        const currentFields = matchingFields(record, subject);
        if (
          reliedOnFields.some(
            (field) =>
              field !== 'userId' && field !== 'messageAuthor' && !currentFields.includes(field)
          )
        )
          return result('no_match');
      }
      if (needsDirectory) {
        // Check generation freshness again after the final REST revalidation.
        const latest = await this.directory.snapshot(guild, signal);
        if (latest.coverage.kind !== 'complete' || latest.coverage !== coverage)
          return result('incomplete_coverage');
      }
      signal.throwIfAborted();
      if (!needsDirectory) coverage = { kind: 'not_required', reason: 'validated_anchor' };
      return {
        kind: 'confirm',
        candidate: {
          ...candidate,
          username: record.username,
          globalName: record.globalName,
          nickname: record.nickname,
          displayName: record.displayName,
          avatarUrl: current.displayAvatarURL(),
        },
        coverage,
        includedEvidenceIds,
        excludedEvidenceIds: [],
      };
    } catch {
      return result(signal.aborted ? 'incomplete_coverage' : 'lookup_failure');
    }
  }

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

    return this.resolveCandidatesFromSignals(message.guild, signals);
  }

  async resolveCandidatesFromSignals(
    guild: Guild,
    signals: CandidateSignalSummary,
    reasonPrefix = ''
  ): Promise<ReportCandidate[]> {
    const candidates = new Map<string, ReportCandidate>();
    const prefix = reasonPrefix ? `${reasonPrefix}: ` : '';

    for (const userId of [...signals.mentions, ...signals.explicitUserIds]) {
      const member = await this.fetchGuildMember(guild, userId);
      if (!member) {
        continue;
      }

      this.mergeCandidate(
        candidates,
        this.buildCandidate(member, `${prefix}explicit Discord ID or mention`)
      );
    }

    for (const link of signals.messageLinks) {
      const linkedMessage = await this.fetchLinkedMessage(guild, link);
      if (!linkedMessage) {
        continue;
      }

      const member = await this.fetchGuildMember(guild, linkedMessage.author.id);
      if (!member) {
        continue;
      }

      this.mergeCandidate(
        candidates,
        this.buildCandidate(member, `${prefix}validated Discord message link`)
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
      .search({ query: searchTerm.trim(), limit: DISCORD_MEMBER_SEARCH_LIMIT })
      .catch((error) => {
        console.warn(`Failed to search report candidate members in guild ${guild.id}:`, error);
        return null;
      });

    if (!fetchedMembers) {
      return [];
    }

    return [...fetchedMembers.values()]
      .filter((member) => this.memberMatchesName(member, normalizedSearchTerm))
      .slice(0, limit)
      .map((member) => ({
        ...this.buildCandidate(member, 'current-server name match'),
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

const NAME_FIELDS = ['username', 'globalName', 'nickname', 'displayName'] as const;
function normalizedName(value: string | null): string {
  return value?.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
}
function matchingFields(
  member: ReportDirectoryMember,
  subject: ReportSubjectClues
): ReportIdentityCandidate['matchedFields'] {
  const fields: ReportIdentityCandidate['matchedFields'] = [];
  if (
    subject.usernames.some(
      (name) => normalizedName(name) && normalizedName(name) === normalizedName(member.username)
    )
  )
    fields.push('username');
  for (const field of NAME_FIELDS) {
    if (
      subject.displayNames.some(
        (name) => normalizedName(name) && normalizedName(name) === normalizedName(member[field])
      )
    )
      fields.push(field);
  }
  return [...new Set(fields)];
}
function supportsAllNames(member: ReportDirectoryMember, subject: ReportSubjectClues): boolean {
  return (
    subject.usernames.every(
      (name) =>
        Boolean(normalizedName(name)) && normalizedName(name) === normalizedName(member.username)
    ) &&
    subject.displayNames.every(
      (name) =>
        Boolean(normalizedName(name)) &&
        NAME_FIELDS.some((field) => normalizedName(name) === normalizedName(member[field]))
    )
  );
}
