import { Client, Guild, GuildBan, GuildMember } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import {
  IIntegrityAuditRepository,
  IntegrityAuditCandidates,
  IntegrityAuditModerationQueueItem,
  IntegrityAuditVerificationEvent,
} from '../repositories/IntegrityAuditRepository';
import {
  ModerationOutcomeSource,
  ModerationQueueItemType,
  RoleQuarantineSnapshot,
  ServerMember,
  VerificationStatus,
} from '../repositories/types';
import {
  DISCORD_UNKNOWN_BAN_ERROR_CODE,
  DISCORD_UNKNOWN_CHANNEL_ERROR_CODE,
  DISCORD_UNKNOWN_MEMBER_ERROR_CODE,
  DISCORD_UNKNOWN_MESSAGE_ERROR_CODE,
  formatDiscordFetchError,
  isDiscordErrorCode,
} from '../utils/discordErrors';
import {
  clampIntegrityAuditDays,
  clampIntegrityAuditLimit,
  IntegrityAuditScope,
  normalizeIntegrityAuditScope,
} from '../utils/integrityAuditSettings';
import { getModerationQueueSettings } from '../utils/moderationQueueSettings';
import {
  getResolutionAdminActionType,
  getResolutionModerationOutcomeType,
  isResolvedVerificationStatus,
} from '../utils/verificationResolution';

const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_DETAIL_MAX_LENGTH = 180;
const ADMIN_ACTION_EXEMPT_RESOLUTION_SOURCES = new Set<unknown>([
  ModerationOutcomeSource.NATIVE_DISCORD,
  ModerationOutcomeSource.EXTERNAL_BOT,
  ModerationOutcomeSource.UNKNOWN_EXTERNAL,
]);

export type IntegrityAuditFindingSeverity = 'error' | 'warning' | 'info';

export interface IntegrityAuditOptions {
  readonly scope?: string | null;
  readonly days?: number | null;
  readonly limit?: number | null;
  readonly userId?: string;
}

export interface IntegrityAuditFinding {
  readonly severity: IntegrityAuditFindingSeverity;
  readonly code: string;
  readonly subject: string;
  readonly detail: string;
  readonly userId?: string;
  readonly verificationEventId?: string;
}

export interface IntegrityAuditReport {
  readonly guildId: string;
  readonly checkedAt: Date;
  readonly scope: IntegrityAuditScope;
  readonly days: number;
  readonly limit: number;
  readonly userId?: string;
  readonly candidateCounts: {
    readonly pendingCases: number;
    readonly recentResolvedCases: number;
    readonly caseRoleMembers: number;
    readonly activeRoleQuarantines: number;
    readonly queueItems: number;
  };
  readonly findings: IntegrityAuditFinding[];
}

export interface IIntegrityAuditService {
  auditGuild(guild: Guild, options?: IntegrityAuditOptions): Promise<IntegrityAuditReport>;
}

interface FetchFound<T> {
  readonly status: 'found';
  readonly value: T;
}

interface FetchMissing {
  readonly status: 'missing';
}

interface FetchFailed {
  readonly status: 'failed';
  readonly detail: string;
}

type FetchResult<T> = FetchFound<T> | FetchMissing | FetchFailed;

interface MessageFetchableChannel {
  readonly id: string;
  readonly messages: {
    fetch(messageId: string): Promise<unknown>;
  };
}

interface LiveUserState {
  readonly userId: string;
  readonly member: FetchResult<GuildMember>;
  readonly ban: FetchResult<GuildBan>;
}

@injectable()
export class IntegrityAuditService implements IIntegrityAuditService {
  public constructor(
    @inject(TYPES.DiscordClient) private readonly client: Client,
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.IntegrityAuditRepository)
    private readonly integrityAuditRepository: IIntegrityAuditRepository
  ) {}

  public async auditGuild(
    guild: Guild,
    options: IntegrityAuditOptions = {}
  ): Promise<IntegrityAuditReport> {
    const scope = normalizeIntegrityAuditScope(options.scope);
    const days = clampIntegrityAuditDays(options.days);
    const limit = clampIntegrityAuditLimit(options.limit);
    const checkedAt = new Date();
    const since = new Date(checkedAt.getTime() - days * DAY_MS);
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const candidates = await this.integrityAuditRepository.listCandidates({
      serverId: guild.id,
      since,
      limit,
      userId: options.userId,
    });
    const findings: IntegrityAuditFinding[] = [];
    const liveUsers = await this.inspectLiveUsers(guild, this.collectUserIds(candidates, scope));
    const caseRoleMemberIds = this.collectCaseRoleMemberIds(candidates.caseRoleMembers);
    this.addLiveUserFetchFindings(liveUsers, findings);

    if (this.includesCaseChecks(scope)) {
      await this.auditPendingCases(
        candidates.pendingVerificationEvents,
        liveUsers,
        serverConfig.case_role_id,
        caseRoleMemberIds,
        !this.includesCaseRoleChecks(scope),
        findings
      );
      this.auditResolvedCases(candidates.recentResolvedVerificationEvents, liveUsers, findings);
    }

    if (this.includesCaseRoleChecks(scope)) {
      this.auditCaseRoleMembers(
        candidates.caseRoleMembers,
        liveUsers,
        serverConfig.case_role_id,
        findings
      );
      this.auditRoleQuarantines(candidates.activeRoleQuarantineSnapshots, liveUsers, findings);
    }

    if (this.includesQueueChecks(scope)) {
      await this.auditQueueItems(
        candidates.moderationQueueItems,
        getModerationQueueSettings(serverConfig.settings).channelId,
        findings
      );
    }

    return {
      guildId: guild.id,
      checkedAt,
      scope,
      days,
      limit,
      userId: options.userId,
      candidateCounts: {
        pendingCases: candidates.pendingVerificationEvents.length,
        recentResolvedCases: candidates.recentResolvedVerificationEvents.length,
        caseRoleMembers: candidates.caseRoleMembers.length,
        activeRoleQuarantines: candidates.activeRoleQuarantineSnapshots.length,
        queueItems: candidates.moderationQueueItems.length,
      },
      findings,
    };
  }

  private async auditPendingCases(
    cases: IntegrityAuditVerificationEvent[],
    liveUsers: Map<string, LiveUserState>,
    caseRoleId: string | null,
    caseRoleMemberIds: ReadonlySet<string>,
    includeCaseRoleFindings: boolean,
    findings: IntegrityAuditFinding[]
  ): Promise<void> {
    for (const verificationEvent of cases) {
      const liveUser = liveUsers.get(verificationEvent.user_id);

      if (liveUser?.ban.status === 'found') {
        findings.push(
          this.buildCaseFinding(
            'error',
            'pending_case_user_banned',
            verificationEvent,
            'User is banned in Discord while the verification case is still pending.'
          )
        );
      }

      if (liveUser?.member.status === 'missing') {
        findings.push(
          this.buildCaseFinding(
            'warning',
            'pending_case_member_missing',
            verificationEvent,
            'User is not currently a guild member; no automatic member-left repair was applied.'
          )
        );
      }

      if (
        includeCaseRoleFindings &&
        caseRoleId &&
        caseRoleMemberIds.has(verificationEvent.user_id) &&
        liveUser?.member.status === 'found' &&
        !liveUser.member.value.roles.cache.has(caseRoleId)
      ) {
        findings.push(
          this.buildCaseFinding(
            'warning',
            'pending_case_role_missing',
            verificationEvent,
            'Pending case member does not currently have the configured case role.'
          )
        );
      }

      await this.auditCaseThread(verificationEvent, findings);
      await this.auditNotificationMessage(verificationEvent, findings);
    }
  }

  private auditResolvedCases(
    cases: IntegrityAuditVerificationEvent[],
    liveUsers: Map<string, LiveUserState>,
    findings: IntegrityAuditFinding[]
  ): void {
    for (const verificationEvent of cases) {
      if (
        this.requiresAdminAction(verificationEvent) &&
        !this.hasExpectedAdminAction(verificationEvent)
      ) {
        findings.push(
          this.buildCaseFinding(
            'error',
            'resolved_case_missing_admin_action',
            verificationEvent,
            'Resolved case has no matching durable admin action row.'
          )
        );
      }

      if (
        this.requiresModerationOutcome(verificationEvent) &&
        !this.hasExpectedOutcome(verificationEvent)
      ) {
        findings.push(
          this.buildCaseFinding(
            'error',
            'resolved_case_missing_moderation_outcome',
            verificationEvent,
            'Resolved case has no matching durable moderation outcome row.'
          )
        );
      }

      const liveUser = liveUsers.get(verificationEvent.user_id);

      if (
        verificationEvent.status === VerificationStatus.BANNED &&
        liveUser?.ban.status === 'missing'
      ) {
        findings.push(
          this.buildCaseFinding(
            'warning',
            'banned_case_not_in_ban_list',
            verificationEvent,
            'Case is recorded as banned, but the user is not currently in the Discord ban list.'
          )
        );
      }
    }
  }

  private auditCaseRoleMembers(
    members: ServerMember[],
    liveUsers: Map<string, LiveUserState>,
    caseRoleId: string | null,
    findings: IntegrityAuditFinding[]
  ): void {
    for (const member of members) {
      if (!this.shouldAuditCaseRoleMember(member)) {
        continue;
      }

      const liveUser = liveUsers.get(member.user_id);

      if (liveUser?.member.status === 'missing') {
        findings.push({
          severity: 'warning',
          code: 'case_role_member_missing',
          subject: `member ${member.user_id}`,
          detail:
            'Database marks this member as having the case role, but Discord does not show guild membership.',
          userId: member.user_id,
        });
      }

      if (
        caseRoleId &&
        liveUser?.member.status === 'found' &&
        !liveUser.member.value.roles.cache.has(caseRoleId)
      ) {
        findings.push({
          severity: 'warning',
          code: 'case_role_member_role_missing',
          subject: `member ${member.user_id}`,
          detail:
            'Database marks this member as having the case role, but the configured case role is absent.',
          userId: member.user_id,
        });
      }

      if (member.verification_status !== VerificationStatus.PENDING) {
        findings.push({
          severity: 'warning',
          code: 'case_role_member_resolved_status',
          subject: `member ${member.user_id}`,
          detail: `Database marks this member as having the case role while verification_status is ${member.verification_status ?? 'unset'}.`,
          userId: member.user_id,
        });
      }
    }
  }

  private auditRoleQuarantines(
    snapshots: RoleQuarantineSnapshot[],
    liveUsers: Map<string, LiveUserState>,
    findings: IntegrityAuditFinding[]
  ): void {
    for (const snapshot of snapshots) {
      const liveUser = liveUsers.get(snapshot.user_id);

      if (liveUser?.member.status === 'missing') {
        findings.push({
          severity: 'warning',
          code: 'active_role_quarantine_member_missing',
          subject: `role quarantine ${snapshot.id}`,
          detail:
            'Active role-quarantine snapshot belongs to a user who is not currently a guild member.',
          userId: snapshot.user_id,
          verificationEventId: snapshot.verification_event_id ?? undefined,
        });
      }
    }
  }

  private async auditQueueItems(
    items: IntegrityAuditModerationQueueItem[],
    configuredQueueChannelId: string | null,
    findings: IntegrityAuditFinding[]
  ): Promise<void> {
    for (const item of items) {
      if (configuredQueueChannelId && item.queue_channel_id !== configuredQueueChannelId) {
        findings.push({
          severity: 'warning',
          code: 'queue_item_wrong_channel',
          subject: `queue item ${item.id}`,
          detail:
            'Queue item points at a channel other than the configured moderation queue channel.',
          userId: item.user_id,
          verificationEventId: item.verification_event_id ?? undefined,
        });
      }

      if (
        item.item_type === ModerationQueueItemType.CASE_MIRROR &&
        item.verification_event_status !== VerificationStatus.PENDING
      ) {
        findings.push({
          severity: 'warning',
          code: 'queue_case_mirror_not_pending',
          subject: `queue item ${item.id}`,
          detail: `Case mirror references a ${item.verification_event_status ?? 'missing'} verification event.`,
          userId: item.user_id,
          verificationEventId: item.verification_event_id ?? undefined,
        });
      }

      if (!item.queue_channel_id || !item.queue_message_id) {
        findings.push({
          severity: 'warning',
          code: 'queue_item_missing_message_pointer',
          subject: `queue item ${item.id}`,
          detail: 'Queue item does not have both queue_channel_id and queue_message_id recorded.',
          userId: item.user_id,
          verificationEventId: item.verification_event_id ?? undefined,
        });
        continue;
      }

      const message = await this.fetchMessage(item.queue_channel_id, item.queue_message_id);
      if (message.status === 'missing') {
        findings.push({
          severity: 'warning',
          code: 'queue_message_missing',
          subject: `queue item ${item.id}`,
          detail: 'Stored queue message was not found in Discord.',
          userId: item.user_id,
          verificationEventId: item.verification_event_id ?? undefined,
        });
      } else if (message.status === 'failed') {
        findings.push({
          severity: 'warning',
          code: 'queue_message_fetch_failed',
          subject: `queue item ${item.id}`,
          detail: message.detail,
          userId: item.user_id,
          verificationEventId: item.verification_event_id ?? undefined,
        });
      }
    }
  }

  private async auditCaseThread(
    verificationEvent: IntegrityAuditVerificationEvent,
    findings: IntegrityAuditFinding[]
  ): Promise<void> {
    if (!verificationEvent.thread_id) {
      findings.push(
        this.buildCaseFinding(
          'warning',
          'pending_case_thread_missing',
          verificationEvent,
          'Pending case does not have a stored user-facing thread ID.'
        )
      );
      return;
    }

    const thread = await this.fetchChannel(verificationEvent.thread_id);
    if (thread.status === 'missing') {
      findings.push(
        this.buildCaseFinding(
          'warning',
          'pending_case_thread_not_found',
          verificationEvent,
          'Stored user-facing case thread was not found in Discord.'
        )
      );
    } else if (thread.status === 'failed') {
      findings.push(
        this.buildCaseFinding(
          'warning',
          'pending_case_thread_fetch_failed',
          verificationEvent,
          thread.detail
        )
      );
    }
  }

  private async auditNotificationMessage(
    verificationEvent: IntegrityAuditVerificationEvent,
    findings: IntegrityAuditFinding[]
  ): Promise<void> {
    if (!verificationEvent.notification_channel_id || !verificationEvent.notification_message_id) {
      findings.push(
        this.buildCaseFinding(
          'warning',
          'pending_case_notification_pointer_missing',
          verificationEvent,
          'Pending case does not have both notification channel and message IDs recorded.'
        )
      );
      return;
    }

    const message = await this.fetchMessage(
      verificationEvent.notification_channel_id,
      verificationEvent.notification_message_id
    );
    if (message.status === 'missing') {
      findings.push(
        this.buildCaseFinding(
          'warning',
          'pending_case_notification_not_found',
          verificationEvent,
          'Stored admin notification message was not found in Discord.'
        )
      );
    } else if (message.status === 'failed') {
      findings.push(
        this.buildCaseFinding(
          'warning',
          'pending_case_notification_fetch_failed',
          verificationEvent,
          message.detail
        )
      );
    }
  }

  private async inspectLiveUsers(
    guild: Guild,
    userIds: Set<string>
  ): Promise<Map<string, LiveUserState>> {
    const liveUsers = new Map<string, LiveUserState>();
    for (const userId of userIds) {
      liveUsers.set(userId, {
        userId,
        member: await this.fetchGuildMember(guild, userId),
        ban: await this.fetchGuildBan(guild, userId),
      });
    }
    return liveUsers;
  }

  private collectUserIds(
    candidates: IntegrityAuditCandidates,
    scope: IntegrityAuditScope
  ): Set<string> {
    const userIds = new Set<string>();
    if (this.includesCaseChecks(scope)) {
      for (const verificationEvent of candidates.pendingVerificationEvents) {
        userIds.add(verificationEvent.user_id);
      }
      for (const verificationEvent of candidates.recentResolvedVerificationEvents) {
        userIds.add(verificationEvent.user_id);
      }
    }
    if (this.includesCaseRoleChecks(scope)) {
      for (const member of candidates.caseRoleMembers) {
        if (!this.shouldAuditCaseRoleMember(member)) {
          continue;
        }
        userIds.add(member.user_id);
      }
      for (const snapshot of candidates.activeRoleQuarantineSnapshots) {
        userIds.add(snapshot.user_id);
      }
    }
    return userIds;
  }

  private collectCaseRoleMemberIds(members: ServerMember[]): Set<string> {
    const userIds = new Set<string>();
    for (const member of members) {
      if (member.case_role_active && this.shouldAuditCaseRoleMember(member)) {
        userIds.add(member.user_id);
      }
    }
    return userIds;
  }

  private async fetchGuildMember(guild: Guild, userId: string): Promise<FetchResult<GuildMember>> {
    try {
      return { status: 'found', value: await guild.members.fetch(userId) };
    } catch (error) {
      if (isDiscordErrorCode(error, DISCORD_UNKNOWN_MEMBER_ERROR_CODE)) {
        return { status: 'missing' };
      }
      return { status: 'failed', detail: formatDiscordFetchError(error, ERROR_DETAIL_MAX_LENGTH) };
    }
  }

  private async fetchGuildBan(guild: Guild, userId: string): Promise<FetchResult<GuildBan>> {
    try {
      return { status: 'found', value: await guild.bans.fetch(userId) };
    } catch (error) {
      if (isDiscordErrorCode(error, DISCORD_UNKNOWN_BAN_ERROR_CODE)) {
        return { status: 'missing' };
      }
      return { status: 'failed', detail: formatDiscordFetchError(error, ERROR_DETAIL_MAX_LENGTH) };
    }
  }

  private async fetchChannel(channelId: string): Promise<FetchResult<unknown>> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      return channel ? { status: 'found', value: channel } : { status: 'missing' };
    } catch (error) {
      if (isDiscordErrorCode(error, DISCORD_UNKNOWN_CHANNEL_ERROR_CODE)) {
        return { status: 'missing' };
      }
      return { status: 'failed', detail: formatDiscordFetchError(error, ERROR_DETAIL_MAX_LENGTH) };
    }
  }

  private async fetchMessage(channelId: string, messageId: string): Promise<FetchResult<unknown>> {
    const channel = await this.fetchChannel(channelId);
    if (channel.status !== 'found') {
      return channel;
    }
    if (!this.hasMessageFetcher(channel.value)) {
      return {
        status: 'failed',
        detail: 'Stored channel cannot fetch messages or is not a message channel.',
      };
    }

    try {
      const message = await channel.value.messages.fetch(messageId);
      return message ? { status: 'found', value: message } : { status: 'missing' };
    } catch (error) {
      if (isDiscordErrorCode(error, DISCORD_UNKNOWN_MESSAGE_ERROR_CODE)) {
        return { status: 'missing' };
      }
      return { status: 'failed', detail: formatDiscordFetchError(error, ERROR_DETAIL_MAX_LENGTH) };
    }
  }

  private hasMessageFetcher(channel: unknown): channel is MessageFetchableChannel {
    if (!channel || typeof channel !== 'object' || !('messages' in channel)) {
      return false;
    }
    const messages = (channel as { messages?: unknown }).messages;
    return Boolean(
      messages &&
      typeof messages === 'object' &&
      typeof (messages as { fetch?: unknown }).fetch === 'function'
    );
  }

  private addLiveUserFetchFindings(
    liveUsers: Map<string, LiveUserState>,
    findings: IntegrityAuditFinding[]
  ): void {
    for (const [userId, liveUser] of liveUsers) {
      if (liveUser.member.status === 'failed') {
        findings.push({
          severity: 'warning',
          code: 'member_fetch_failed',
          subject: `member ${userId}`,
          detail: liveUser.member.detail,
          userId,
        });
      }
      if (liveUser.ban.status === 'failed') {
        findings.push({
          severity: 'warning',
          code: 'ban_fetch_failed',
          subject: `member ${userId}`,
          detail: liveUser.ban.detail,
          userId,
        });
      }
    }
  }

  private buildCaseFinding(
    severity: IntegrityAuditFindingSeverity,
    code: string,
    verificationEvent: IntegrityAuditVerificationEvent,
    detail: string
  ): IntegrityAuditFinding {
    return {
      severity,
      code,
      subject: `case ${verificationEvent.id}`,
      detail,
      userId: verificationEvent.user_id,
      verificationEventId: verificationEvent.id,
    };
  }

  private requiresAdminAction(verificationEvent: IntegrityAuditVerificationEvent): boolean {
    return (
      isResolvedVerificationStatus(verificationEvent.status) &&
      !this.hasAdminActionExemptResolutionSource(verificationEvent)
    );
  }

  private requiresModerationOutcome(verificationEvent: IntegrityAuditVerificationEvent): boolean {
    return isResolvedVerificationStatus(verificationEvent.status);
  }

  private hasExpectedOutcome(verificationEvent: IntegrityAuditVerificationEvent): boolean {
    if (!isResolvedVerificationStatus(verificationEvent.status)) {
      return false;
    }

    const expectedOutcome = getResolutionModerationOutcomeType(verificationEvent.status);
    return verificationEvent.moderation_outcomes.some(
      (outcome) => outcome.outcome_type === expectedOutcome
    );
  }

  private hasExpectedAdminAction(verificationEvent: IntegrityAuditVerificationEvent): boolean {
    if (!isResolvedVerificationStatus(verificationEvent.status)) {
      return false;
    }

    const expectedAction = getResolutionAdminActionType(verificationEvent.status);
    return verificationEvent.admin_actions.some((action) => action.action_type === expectedAction);
  }

  private hasAdminActionExemptResolutionSource(
    verificationEvent: IntegrityAuditVerificationEvent
  ): boolean {
    if (
      this.isAdminActionExemptResolutionSource(this.getMetadataResolutionSource(verificationEvent))
    ) {
      return true;
    }
    if (!isResolvedVerificationStatus(verificationEvent.status)) {
      return false;
    }

    const expectedOutcome = getResolutionModerationOutcomeType(verificationEvent.status);
    return verificationEvent.moderation_outcomes.some(
      (outcome) =>
        outcome.outcome_type === expectedOutcome &&
        this.isAdminActionExemptResolutionSource(outcome.source)
    );
  }

  private getMetadataResolutionSource(verificationEvent: IntegrityAuditVerificationEvent): unknown {
    const metadata = verificationEvent.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    return (metadata as { moderation_outcome_source?: unknown }).moderation_outcome_source;
  }

  private isAdminActionExemptResolutionSource(source: unknown): boolean {
    return ADMIN_ACTION_EXEMPT_RESOLUTION_SOURCES.has(source);
  }

  private shouldAuditCaseRoleMember(member: ServerMember): boolean {
    return member.verification_status !== VerificationStatus.BANNED;
  }

  private includesCaseChecks(scope: IntegrityAuditScope): boolean {
    return scope === 'all' || scope === 'cases';
  }

  private includesCaseRoleChecks(scope: IntegrityAuditScope): boolean {
    return scope === 'all' || scope === 'case_role';
  }

  private includesQueueChecks(scope: IntegrityAuditScope): boolean {
    return scope === 'all' || scope === 'queue';
  }
}
