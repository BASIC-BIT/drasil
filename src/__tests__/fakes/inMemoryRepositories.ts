import type { IAdminActionRepository } from '../../repositories/AdminActionRepository';
import type { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import type { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import type { IServerRepository } from '../../repositories/ServerRepository';
import type { IUserRepository } from '../../repositories/UserRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { verification_status } from '@prisma/client';
import {
  AdminAction,
  AdminActionCreate,
  DetectionEvent,
  Server,
  ServerMember,
  ServerSettings,
  User,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { globalConfig } from '../../config/GlobalConfig';

const toTimestamp = (value: string | Date | null | undefined): number => {
  if (!value) {
    return 0;
  }
  return new Date(value).getTime();
};

const globalSettings = globalConfig.getSettings();

const baseSettings: ServerSettings = {
  min_confidence_threshold: globalSettings.defaultServerSettings.minConfidenceThreshold,
  auto_restrict: true,
  use_gpt_on_join: true,
  gpt_message_check_count: 3,
  message_retention_days: globalSettings.defaultServerSettings.messageRetentionDays,
  detection_retention_days: globalSettings.defaultServerSettings.detectionRetentionDays,
};

const defaultHeuristicThreshold = globalSettings.defaultServerSettings.messageThreshold;
const defaultHeuristicTimeframeSeconds = globalSettings.defaultServerSettings.messageTimeframe;
const defaultHeuristicKeywords = [...globalSettings.defaultSuspiciousKeywords];

export class InMemoryDetectionEventsRepository implements IDetectionEventsRepository {
  private events: DetectionEvent[] = [];
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `det-${this.idCounter}`;
  }

  async create(data: Partial<DetectionEvent>): Promise<DetectionEvent> {
    if (!data.server_id || !data.user_id || !data.detection_type || data.confidence === undefined) {
      throw new Error(
        'server_id, user_id, detection_type, and confidence are required to create a detection event'
      );
    }

    const event: DetectionEvent = {
      id: this.nextId(),
      server_id: data.server_id,
      user_id: data.user_id,
      detection_type: data.detection_type,
      confidence: data.confidence,
      reasons: data.reasons ?? [],
      detected_at: data.detected_at ?? new Date(),
      thread_id: data.thread_id ?? null,
      message_id: data.message_id ?? null,
      channel_id: data.channel_id ?? null,
      metadata: data.metadata ?? {},
    };

    this.events.push(event);
    return { ...event };
  }

  async findByServerAndUser(serverId: string, userId: string): Promise<DetectionEvent[]> {
    return this.events
      .filter((event) => event.server_id === serverId && event.user_id === userId)
      .sort((a, b) => toTimestamp(b.detected_at) - toTimestamp(a.detected_at))
      .map((event) => ({ ...event }));
  }

  async findRecentByServer(serverId: string, limit: number = 50): Promise<DetectionEvent[]> {
    return this.events
      .filter((event) => event.server_id === serverId)
      .sort((a, b) => toTimestamp(b.detected_at) - toTimestamp(a.detected_at))
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }

  async recordAdminAction(
    id: string,
    action: 'Verified' | 'Banned' | 'Ignored',
    adminId: string
  ): Promise<DetectionEvent | null> {
    const event = this.events.find((item) => item.id === id);
    if (!event) {
      return null;
    }

    const mutableEvent = event as DetectionEvent & {
      admin_action?: string;
      admin_action_by?: string;
      admin_action_at?: Date;
    };

    mutableEvent.admin_action = action;
    mutableEvent.admin_action_by = adminId;
    mutableEvent.admin_action_at = new Date();

    return { ...event };
  }

  async cleanupOldEvents(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const beforeCount = this.events.length;
    this.events = this.events.filter((event) => toTimestamp(event.detected_at) >= cutoff.getTime());
    return beforeCount - this.events.length;
  }

  async findById(id: string): Promise<DetectionEvent | null> {
    const event = this.events.find((item) => item.id === id);
    return event ? { ...event } : null;
  }
}

export class InMemoryVerificationEventRepository implements IVerificationEventRepository {
  private events: VerificationEvent[] = [];
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `ver-${this.idCounter}`;
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<VerificationEvent[]> {
    const filtered = this.events
      .filter((event) => event.user_id === userId && event.server_id === serverId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

    const start = options.offset ?? 0;
    const end = options.limit ? start + options.limit : undefined;
    return filtered
      .slice(start, end)
      .reverse()
      .map((event) => ({ ...event }));
  }

  async findActiveByUserAndServer(
    userId: string,
    serverId: string
  ): Promise<VerificationEvent | null> {
    const pending = this.events
      .filter(
        (event) =>
          event.user_id === userId &&
          event.server_id === serverId &&
          event.status === VerificationStatus.PENDING
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return pending[0] ? { ...pending[0] } : null;
  }

  async findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]> {
    return this.events
      .filter((event) => event.detection_event_id === detectionEventId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map((event) => ({ ...event }));
  }

  async createFromDetection(
    detectionEventId: string | null,
    serverId: string,
    userId: string,
    status: VerificationStatus
  ): Promise<VerificationEvent> {
    const now = new Date();
    const event: VerificationEvent = {
      id: this.nextId(),
      server_id: serverId,
      user_id: userId,
      detection_event_id: detectionEventId,
      thread_id: null,
      notification_message_id: null,
      status,
      created_at: now,
      updated_at: now,
      resolved_at: null,
      resolved_by: null,
      notes: null,
      metadata: null,
    };

    this.events.push(event);
    return { ...event };
  }

  async getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]> {
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }

  async findById(id: string): Promise<VerificationEvent | null> {
    const event = this.events.find((item) => item.id === id);
    return event ? { ...event } : null;
  }

  async update(id: string, data: Partial<VerificationEvent>): Promise<VerificationEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === id);
    if (eventIndex === -1) {
      return null;
    }

    const existing = this.events[eventIndex];
    const updated: VerificationEvent = { ...existing };

    if (data.thread_id !== undefined) updated.thread_id = data.thread_id;
    if (data.notification_message_id !== undefined)
      updated.notification_message_id = data.notification_message_id;
    if (data.notes !== undefined) updated.notes = data.notes;
    if (data.metadata !== undefined) updated.metadata = data.metadata;
    if (data.resolved_at !== undefined) updated.resolved_at = data.resolved_at;
    if (data.resolved_by !== undefined) updated.resolved_by = data.resolved_by;

    if (data.status !== undefined) {
      updated.status = data.status;
      if (
        data.status === VerificationStatus.VERIFIED ||
        data.status === VerificationStatus.BANNED
      ) {
        updated.resolved_at = data.resolved_at ?? new Date();
        updated.resolved_by = data.resolved_by ?? updated.resolved_by;
      }
      if (data.status === VerificationStatus.PENDING) {
        updated.resolved_at = null;
        updated.resolved_by = null;
      }
    }

    updated.updated_at = new Date();
    this.events[eventIndex] = updated;
    return { ...updated };
  }
}

export class InMemoryServerRepository implements IServerRepository {
  private servers = new Map<string, Server>();

  private cloneServer(server: Server): Server {
    return {
      ...server,
      settings: { ...server.settings },
      heuristic_suspicious_keywords: [...server.heuristic_suspicious_keywords],
    };
  }

  private buildServer(guildId: string, data: Partial<Server>): Server {
    const now = new Date().toISOString();
    return {
      guild_id: guildId,
      restricted_role_id: data.restricted_role_id ?? null,
      admin_channel_id: data.admin_channel_id ?? null,
      verification_channel_id: data.verification_channel_id ?? null,
      admin_notification_role_id: data.admin_notification_role_id ?? null,
      heuristic_message_threshold: data.heuristic_message_threshold ?? defaultHeuristicThreshold,
      heuristic_message_timeframe_seconds:
        data.heuristic_message_timeframe_seconds ?? defaultHeuristicTimeframeSeconds,
      heuristic_suspicious_keywords: data.heuristic_suspicious_keywords?.map(
        (keyword) => keyword
      ) ?? [...defaultHeuristicKeywords],
      created_at: data.created_at ?? now,
      updated_at: data.updated_at ?? now,
      updated_by: data.updated_by ?? null,
      settings: data.settings ?? { ...baseSettings },
      is_active: data.is_active ?? true,
    };
  }

  async findById(id: string): Promise<Server | null> {
    return this.findByGuildId(id);
  }

  async findByGuildId(guildId: string): Promise<Server | null> {
    const server = this.servers.get(guildId);
    return server ? this.cloneServer(server) : null;
  }

  async upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server> {
    const existing = this.servers.get(guildId);
    const updated = existing
      ? {
          ...existing,
          ...data,
          settings: data.settings ?? existing.settings,
          heuristic_suspicious_keywords:
            data.heuristic_suspicious_keywords ?? existing.heuristic_suspicious_keywords,
          updated_at: new Date().toISOString(),
        }
      : this.buildServer(guildId, data);
    this.servers.set(guildId, updated);
    return this.cloneServer(updated);
  }

  async updateSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server | null> {
    const existing = this.servers.get(guildId);
    if (!existing) {
      return null;
    }
    const mergedSettings = {
      ...existing.settings,
      ...settings,
    };
    const updated = {
      ...existing,
      settings: mergedSettings,
      updated_at: new Date().toISOString(),
    };
    this.servers.set(guildId, updated);
    return this.cloneServer(updated);
  }

  async setActive(guildId: string, isActive: boolean): Promise<Server | null> {
    const existing = this.servers.get(guildId);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };
    this.servers.set(guildId, updated);
    return this.cloneServer(updated);
  }

  async findAllActive(): Promise<Server[]> {
    return Array.from(this.servers.values())
      .filter((server) => server.is_active)
      .map((server) => this.cloneServer(server));
  }

  async getOrCreateServer(guildId: string): Promise<Server> {
    const existing = await this.findByGuildId(guildId);
    if (existing) {
      return existing;
    }
    return this.upsertByGuildId(guildId, {});
  }
}

export class InMemoryUserRepository implements IUserRepository {
  private users = new Map<string, User>();

  private buildUser(discordId: string, data: Partial<User>): User {
    const now = new Date().toISOString();
    return {
      discord_id: discordId,
      username: data.username ?? null,
      created_at: data.created_at ?? now,
      updated_at: data.updated_at ?? now,
      created_by: data.created_by ?? null,
      updated_by: data.updated_by ?? null,
      global_reputation_score: data.global_reputation_score,
      account_created_at: data.account_created_at ?? null,
      metadata: data.metadata,
      suspicious_server_count: data.suspicious_server_count ?? 0,
      first_flagged_at: data.first_flagged_at ?? null,
    };
  }

  async findById(id: string): Promise<User | null> {
    return this.findByDiscordId(id);
  }

  async findByDiscordId(discordId: string): Promise<User | null> {
    const user = this.users.get(discordId);
    return user ? { ...user } : null;
  }

  async upsertByDiscordId(discordId: string, data: Partial<User>): Promise<User> {
    const existing = this.users.get(discordId);
    const updated = existing
      ? {
          ...existing,
          ...data,
          updated_at: new Date().toISOString(),
        }
      : this.buildUser(discordId, data);
    this.users.set(discordId, updated);
    return { ...updated };
  }

  async updateReputationScore(discordId: string, score: number): Promise<User | null> {
    const existing = this.users.get(discordId);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      global_reputation_score: score,
      updated_at: new Date().toISOString(),
    };
    this.users.set(discordId, updated);
    return { ...updated };
  }

  async findByReputationBelow(threshold: number): Promise<User[]> {
    return Array.from(this.users.values())
      .filter((user) => (user.global_reputation_score ?? 0) < threshold)
      .map((user) => ({ ...user }));
  }

  async incrementSuspiciousServerCount(discordId: string): Promise<User | null> {
    const existing = this.users.get(discordId);
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      suspicious_server_count: (existing.suspicious_server_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    };
    this.users.set(discordId, updated);
    return { ...updated };
  }

  async decrementSuspiciousServerCount(discordId: string): Promise<User | null> {
    const existing = this.users.get(discordId);
    if (!existing) {
      return null;
    }
    const newCount = Math.max(0, (existing.suspicious_server_count ?? 0) - 1);
    const updated = {
      ...existing,
      suspicious_server_count: newCount,
      updated_at: new Date().toISOString(),
    };
    this.users.set(discordId, updated);
    return { ...updated };
  }

  async setFirstFlagged(discordId: string, timestamp?: string): Promise<User | null> {
    const existing = this.users.get(discordId);
    if (!existing) {
      return null;
    }
    if (existing.first_flagged_at) {
      return { ...existing };
    }
    const updated = {
      ...existing,
      first_flagged_at: timestamp ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.users.set(discordId, updated);
    return { ...updated };
  }

  async findUsersFlaggedInMultipleServers(threshold: number = 2): Promise<User[]> {
    return Array.from(this.users.values())
      .filter((user) => (user.suspicious_server_count ?? 0) >= threshold)
      .map((user) => ({ ...user }));
  }

  async getOrCreateUser(
    discordId: string,
    username?: string,
    accountCreatedAt?: Date
  ): Promise<User> {
    const existing = this.users.get(discordId);
    if (existing) {
      const updated = {
        ...existing,
        username: username ?? existing.username,
        account_created_at: accountCreatedAt
          ? accountCreatedAt.toISOString()
          : existing.account_created_at,
        updated_at: new Date().toISOString(),
      };
      this.users.set(discordId, updated);
      return { ...updated };
    }

    const newUser = this.buildUser(discordId, {
      username: username ?? 'Unknown User',
      global_reputation_score: 100,
      account_created_at: accountCreatedAt ? accountCreatedAt.toISOString() : null,
    });
    this.users.set(discordId, newUser);
    return { ...newUser };
  }
}

export class InMemoryServerMemberRepository implements IServerMemberRepository {
  private members = new Map<string, ServerMember>();

  private key(serverId: string, userId: string): string {
    return `${serverId}:${userId}`;
  }

  async findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null> {
    const member = this.members.get(this.key(serverId, userId));
    return member ? { ...member } : null;
  }

  async upsertMember(
    serverId: string,
    userId: string,
    data: Partial<ServerMember>
  ): Promise<ServerMember> {
    const existing = this.members.get(this.key(serverId, userId));
    const updated: ServerMember = {
      server_id: serverId,
      user_id: userId,
      join_date: data.join_date ?? existing?.join_date ?? null,
      reputation_score: data.reputation_score ?? existing?.reputation_score ?? 0,
      is_restricted: data.is_restricted ?? existing?.is_restricted ?? false,
      last_verified_at: data.last_verified_at ?? existing?.last_verified_at ?? null,
      last_message_at: data.last_message_at ?? existing?.last_message_at ?? null,
      message_count: data.message_count ?? existing?.message_count ?? 0,
      verification_status:
        data.verification_status ?? existing?.verification_status ?? VerificationStatus.PENDING,
      last_status_change: data.last_status_change ?? existing?.last_status_change ?? null,
      created_by: data.created_by ?? existing?.created_by ?? null,
      updated_by: data.updated_by ?? existing?.updated_by ?? null,
    };
    this.members.set(this.key(serverId, userId), updated);
    return { ...updated };
  }

  async findByServer(serverId: string): Promise<ServerMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.server_id === serverId)
      .map((member) => ({ ...member }));
  }

  async findByUser(userId: string): Promise<ServerMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.user_id === userId)
      .map((member) => ({ ...member }));
  }

  async findRestrictedMembers(serverId: string): Promise<ServerMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.server_id === serverId && member.is_restricted)
      .map((member) => ({ ...member }));
  }

  async updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null> {
    const existing = this.members.get(this.key(serverId, userId));
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      reputation_score: score,
    };
    this.members.set(this.key(serverId, userId), updated);
    return { ...updated };
  }

  async updateRestrictionStatus(
    serverId: string,
    userId: string,
    isRestricted: boolean,
    verificationStatus: verification_status,
    _reason?: string,
    moderatorId?: string
  ): Promise<ServerMember | null> {
    const existing = this.members.get(this.key(serverId, userId));
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      is_restricted: isRestricted,
      verification_status: verificationStatus as VerificationStatus,
      last_status_change: new Date(),
      updated_by: moderatorId ?? null,
    };
    this.members.set(this.key(serverId, userId), updated);
    return { ...updated };
  }

  async incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null> {
    const existing = this.members.get(this.key(serverId, userId));
    if (!existing) {
      return null;
    }
    const updated = {
      ...existing,
      message_count: (existing.message_count ?? 0) + 1,
      last_message_at: new Date().toISOString(),
    };
    this.members.set(this.key(serverId, userId), updated);
    return { ...updated };
  }

  async getOrCreateMember(
    serverId: string,
    userId: string,
    joinDate?: Date
  ): Promise<ServerMember> {
    const existing = await this.findByServerAndUser(serverId, userId);
    if (existing) {
      if (joinDate && existing.join_date?.getTime() !== joinDate.getTime()) {
        return this.upsertMember(serverId, userId, { join_date: joinDate });
      }
      return existing;
    }
    return this.upsertMember(serverId, userId, {
      join_date: joinDate ?? new Date(),
      message_count: 0,
      is_restricted: false,
      reputation_score: 0,
      verification_status: VerificationStatus.PENDING,
    });
  }
}

export class InMemoryAdminActionRepository implements IAdminActionRepository {
  private actions: AdminAction[] = [];
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `act-${this.idCounter}`;
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AdminAction[]> {
    const filtered = this.actions
      .filter((action) => action.user_id === userId && action.server_id === serverId)
      .sort((a, b) => b.action_at.getTime() - a.action_at.getTime());
    const start = options.offset ?? 0;
    const end = options.limit ? start + options.limit : undefined;
    return filtered.slice(start, end).map((action) => ({ ...action }));
  }

  async findByAdmin(
    adminId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AdminAction[]> {
    const filtered = this.actions
      .filter((action) => action.admin_id === adminId)
      .sort((a, b) => b.action_at.getTime() - a.action_at.getTime());
    const start = options.offset ?? 0;
    const end = options.limit ? start + options.limit : undefined;
    return filtered.slice(start, end).map((action) => ({ ...action }));
  }

  async findByVerificationEvent(verificationEventId: string): Promise<AdminAction[]> {
    return this.actions
      .filter((action) => action.verification_event_id === verificationEventId)
      .sort((a, b) => b.action_at.getTime() - a.action_at.getTime())
      .map((action) => ({ ...action }));
  }

  async createAction(data: AdminActionCreate): Promise<AdminAction> {
    const action: AdminAction = {
      id: this.nextId(),
      server_id: data.server_id,
      user_id: data.user_id,
      admin_id: data.admin_id,
      verification_event_id: data.verification_event_id,
      action_type: data.action_type,
      action_at: new Date(),
      previous_status: data.previous_status,
      new_status: data.new_status,
      notes: data.notes ?? null,
      metadata: data.metadata ?? null,
    };
    this.actions.push(action);
    return { ...action };
  }

  async getActionHistory(userId: string, serverId: string): Promise<AdminAction[]> {
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }
}
