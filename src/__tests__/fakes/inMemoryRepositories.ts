import type { IAdminActionRepository } from '../../repositories/AdminActionRepository';
import type { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import type { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import type { IServerRepository } from '../../repositories/ServerRepository';
import type { IUserRepository } from '../../repositories/UserRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import type { IReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import type { IModerationOutcomeRepository } from '../../repositories/ModerationOutcomeRepository';
import type { IRoleQuarantineSnapshotRepository } from '../../repositories/RoleQuarantineSnapshotRepository';
import { verification_status } from '../../db/prisma';
import {
  AdminAction,
  AdminActionCreate,
  DetectionEvent,
  ModerationOutcome,
  ModerationOutcomeCreate,
  ModerationOutcomeType,
  ReportIntake,
  ReportIntakeCreate,
  ReportIntakeEvidence,
  ReportIntakeEvidenceCreate,
  ReportIntakeStatus,
  ReportIntakeUpdate,
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotCreate,
  RoleQuarantineSnapshotStatus,
  RoleQuarantineSnapshotUpdate,
  Server,
  ServerMember,
  ServerSettings,
  User,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { globalConfig } from '../../config/GlobalConfig';
import {
  DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_ENABLED,
  DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT,
} from '../../utils/verificationThreadAnalysisSettings';
import {
  AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY,
  DEFAULT_DETECTION_RESPONSE_MODE,
  DEFAULT_MODERATOR_BAN_ACTION_ENABLED,
  DEFAULT_OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD,
  DEFAULT_OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES,
  MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY,
  OBSERVED_ACTION_BAN_REQUIRES_REASON_SETTING_KEY,
} from '../../utils/detectionResponseSettings';
import {
  DEFAULT_USER_REPORT_EXTERNAL_RESPONSE_MODE,
  DEFAULT_USER_REPORT_REASON_REQUIRED,
  USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../../utils/userReportSettings';
import {
  DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY,
  DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY,
  DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY,
  DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY,
  DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY,
  isDetectionEventExcludedFromAccounting,
} from '../../utils/detectionEventAccounting';
import {
  ANALYTICS_CONSENT_SETTING_KEY,
  DEFAULT_ANALYTICS_CONSENT_LEVEL,
} from '../../utils/analyticsSettings';
import {
  DEFAULT_REPORT_AI_MAX_IMAGE_BYTES,
  DEFAULT_REPORT_AI_MAX_IMAGES,
  DEFAULT_REPORT_AI_OPEN_CASE_THRESHOLD,
  DEFAULT_REPORT_AI_TRIAGE_ENABLED,
  REPORT_AI_ANALYZE_IMAGES_SETTING_KEY,
  REPORT_AI_ANALYZE_TEXT_SETTING_KEY,
  REPORT_AI_MAX_ACTION_SETTING_KEY,
  REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY,
  REPORT_AI_MAX_IMAGES_SETTING_KEY,
  REPORT_AI_OPEN_CASE_THRESHOLD_SETTING_KEY,
  REPORT_AI_TRIAGE_ENABLED_SETTING_KEY,
} from '../../utils/reportAiSettings';
import {
  DEFAULT_ROLE_QUARANTINE_MODE,
  ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY,
  ROLE_QUARANTINE_MODE_SETTING_KEY,
} from '../../utils/roleQuarantineSettings';
import {
  DEFAULT_HONEYPOT_ROLE_RESPONSE_MODE,
  DEFAULT_ROLE_GATE_ENABLED,
  HONEYPOT_ROLE_ID_SETTING_KEY,
  HONEYPOT_ROLE_RESPONSE_MODE_SETTING_KEY,
  MEMBER_ACCESS_ROLE_ID_SETTING_KEY,
  ROLE_GATE_ENABLED_SETTING_KEY,
} from '../../utils/roleGateSettings';

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
  verification_ai_thread_analysis_enabled: DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_ENABLED,
  verification_ai_thread_analysis_message_limit:
    DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT,
  detection_response_mode: DEFAULT_DETECTION_RESPONSE_MODE,
  observed_detection_min_confidence_threshold: DEFAULT_OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD,
  observed_detection_notification_window_minutes:
    DEFAULT_OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES,
  [AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY]: true,
  [OBSERVED_ACTION_BAN_REQUIRES_REASON_SETTING_KEY]: false,
  [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: DEFAULT_MODERATOR_BAN_ACTION_ENABLED,
  [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: DEFAULT_USER_REPORT_REASON_REQUIRED,
  [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: DEFAULT_USER_REPORT_EXTERNAL_RESPONSE_MODE,
  [ANALYTICS_CONSENT_SETTING_KEY]: DEFAULT_ANALYTICS_CONSENT_LEVEL,
  [REPORT_AI_TRIAGE_ENABLED_SETTING_KEY]: DEFAULT_REPORT_AI_TRIAGE_ENABLED,
  [REPORT_AI_ANALYZE_TEXT_SETTING_KEY]: true,
  [REPORT_AI_ANALYZE_IMAGES_SETTING_KEY]: true,
  [REPORT_AI_MAX_ACTION_SETTING_KEY]: 'hints',
  [REPORT_AI_OPEN_CASE_THRESHOLD_SETTING_KEY]: DEFAULT_REPORT_AI_OPEN_CASE_THRESHOLD,
  [REPORT_AI_MAX_IMAGES_SETTING_KEY]: DEFAULT_REPORT_AI_MAX_IMAGES,
  [REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY]: DEFAULT_REPORT_AI_MAX_IMAGE_BYTES,
  report_intake_agent_enabled: true,
  report_intake_agent_debounce_ms: 15_000,
  report_intake_agent_min_interval_ms: 60_000,
  report_intake_confirmed_response_mode: 'observed_alert',
  [ROLE_QUARANTINE_MODE_SETTING_KEY]: DEFAULT_ROLE_QUARANTINE_MODE,
  [ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY]: [],
  [ROLE_GATE_ENABLED_SETTING_KEY]: DEFAULT_ROLE_GATE_ENABLED,
  [HONEYPOT_ROLE_ID_SETTING_KEY]: null,
  [MEMBER_ACCESS_ROLE_ID_SETTING_KEY]: null,
  [HONEYPOT_ROLE_RESPONSE_MODE_SETTING_KEY]: DEFAULT_HONEYPOT_ROLE_RESPONSE_MODE,
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
    if (!data.user_id || !data.detection_type || data.confidence === undefined) {
      throw new Error(
        'user_id, detection_type, and confidence are required to create a detection event'
      );
    }

    const event: DetectionEvent = {
      id: this.nextId(),
      server_id: data.server_id ?? null,
      user_id: data.user_id,
      detection_type: data.detection_type,
      confidence: data.confidence,
      reasons: data.reasons ?? [],
      detected_at: data.detected_at ?? new Date(),
      thread_id: data.thread_id ?? null,
      message_id: data.message_id ?? null,
      channel_id: data.channel_id ?? null,
      latest_verification_event_id: data.latest_verification_event_id ?? null,
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

  async findCountedByServerAndUser(serverId: string, userId: string): Promise<DetectionEvent[]> {
    return this.events
      .filter(
        (event) =>
          event.server_id === serverId &&
          event.user_id === userId &&
          !isDetectionEventExcludedFromAccounting(event)
      )
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

  async findUnresolvedObservedNotificationsByServer(serverId: string): Promise<DetectionEvent[]> {
    return this.events
      .filter((event) => {
        const metadata = event.metadata ?? {};
        return (
          event.server_id === serverId &&
          typeof metadata.observed_notification_message_id === 'string' &&
          typeof metadata.observed_action !== 'string'
        );
      })
      .sort((a, b) => toTimestamp(a.detected_at) - toTimestamp(b.detected_at))
      .map((event) => ({ ...event }));
  }

  async findByReportIntakeId(reportIntakeId: string): Promise<DetectionEvent | null> {
    const event = this.events.find(
      (item) =>
        item.metadata &&
        typeof item.metadata === 'object' &&
        !Array.isArray(item.metadata) &&
        item.metadata.reportIntakeId === reportIntakeId
    );
    return event ? { ...event } : null;
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

  async linkToVerificationEvent(
    detectionEventId: string,
    verificationEventId: string
  ): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const updated = {
      ...this.events[eventIndex],
      latest_verification_event_id: verificationEventId,
    };
    this.events[eventIndex] = updated;
    return { ...updated };
  }

  async updateMetadata(
    detectionEventId: string,
    metadata: Record<string, unknown>
  ): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const updated = {
      ...this.events[eventIndex],
      metadata,
    };
    this.events[eventIndex] = updated;
    return { ...updated };
  }

  async markExcludedFromAccounting(
    detectionEventId: string,
    metadata: Record<string, unknown>
  ): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const updated = {
      ...this.events[eventIndex],
      metadata: {
        ...(this.events[eventIndex].metadata ?? {}),
        ...metadata,
      },
    };
    this.events[eventIndex] = updated;
    return { ...updated };
  }

  async clearAccountingExclusion(detectionEventId: string): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const metadata = { ...(this.events[eventIndex].metadata ?? {}) };
    if (metadata.observed_action === 'false_positive') {
      delete metadata.observed_action;
      delete metadata.observed_action_by;
      delete metadata.observed_action_at;
    }
    delete metadata[DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY];
    delete metadata[DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY];
    delete metadata[DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY];
    delete metadata[DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY];
    delete metadata[DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY];

    const updated = {
      ...this.events[eventIndex],
      metadata,
    };
    this.events[eventIndex] = updated;
    return { ...updated };
  }

  async claimObservedAction(
    detectionEventId: string,
    metadata: Record<string, unknown>
  ): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const existingMetadata = this.events[eventIndex].metadata ?? {};
    if (existingMetadata.observed_action) {
      return null;
    }

    const updated = {
      ...this.events[eventIndex],
      metadata: {
        ...existingMetadata,
        ...metadata,
      },
    };
    this.events[eventIndex] = updated;
    return { ...updated };
  }

  async releaseObservedAction(
    detectionEventId: string,
    actionType: string,
    adminId: string
  ): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const existingMetadata = this.events[eventIndex].metadata ?? {};
    if (
      existingMetadata.observed_action !== actionType ||
      existingMetadata.observed_action_by !== adminId
    ) {
      return null;
    }

    const metadata = { ...existingMetadata };
    delete metadata.observed_action;
    delete metadata.observed_action_by;
    delete metadata.observed_action_at;
    if (actionType === 'false_positive') {
      delete metadata[DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY];
    }
    const updated = {
      ...this.events[eventIndex],
      metadata,
    };
    this.events[eventIndex] = updated;
    return { ...updated };
  }

  async clearObservedAction(
    detectionEventId: string,
    actionTypes: string[]
  ): Promise<DetectionEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === detectionEventId);
    if (eventIndex === -1) {
      return null;
    }

    const existingMetadata = this.events[eventIndex].metadata ?? {};
    if (!actionTypes.includes(String(existingMetadata.observed_action))) {
      return null;
    }

    const metadata = { ...existingMetadata };
    const wasFalsePositive = existingMetadata.observed_action === 'false_positive';
    delete metadata.observed_action;
    delete metadata.observed_action_by;
    delete metadata.observed_action_at;
    if (wasFalsePositive) {
      delete metadata[DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY];
      delete metadata[DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY];
    }
    const updated = {
      ...this.events[eventIndex],
      metadata,
    };
    this.events[eventIndex] = updated;
    return { ...updated };
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

  async findPendingByServer(serverId: string): Promise<VerificationEvent[]> {
    return this.events
      .filter(
        (event) => event.server_id === serverId && event.status === VerificationStatus.PENDING
      )
      .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime())
      .map((event) => ({ ...event }));
  }

  async findResolvedWithThreadsByServer(
    serverId: string,
    options: { days?: number | null; limit?: number | null; userId?: string | null } = {}
  ): Promise<VerificationEvent[]> {
    const days = Math.max(1, Math.min(options.days ?? 30, 365));
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.events
      .filter(
        (event) =>
          event.server_id === serverId &&
          (!options.userId || event.user_id === options.userId) &&
          event.status !== VerificationStatus.PENDING &&
          event.updated_at >= since &&
          Boolean(event.thread_id || event.private_evidence_thread_id)
      )
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
      .slice(0, limit)
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
      private_evidence_thread_id: null,
      notification_channel_id: null,
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

  async findByThreadId(threadId: string): Promise<VerificationEvent | null> {
    const matchingEvents = this.events
      .filter((item) => item.thread_id === threadId && item.status === VerificationStatus.PENDING)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    if (matchingEvents.length === 0) {
      return null;
    }

    return { ...matchingEvents[0] };
  }

  async update(
    id: string,
    data: Partial<VerificationEvent>,
    options: { touchUpdatedAt?: boolean } = {}
  ): Promise<VerificationEvent | null> {
    const eventIndex = this.events.findIndex((item) => item.id === id);
    if (eventIndex === -1) {
      return null;
    }

    const existing = this.events[eventIndex];
    const updated: VerificationEvent = { ...existing };

    if (data.thread_id !== undefined) updated.thread_id = data.thread_id;
    if (data.private_evidence_thread_id !== undefined)
      updated.private_evidence_thread_id = data.private_evidence_thread_id;
    if (data.notification_channel_id !== undefined)
      updated.notification_channel_id = data.notification_channel_id;
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
        data.status === VerificationStatus.BANNED ||
        data.status === VerificationStatus.KICKED ||
        data.status === VerificationStatus.CLOSED_NO_ACTION
      ) {
        updated.resolved_at = data.resolved_at ?? new Date();
        updated.resolved_by = data.resolved_by ?? updated.resolved_by;
      }
      if (data.status === VerificationStatus.PENDING) {
        updated.resolved_at = null;
        updated.resolved_by = null;
      }
    }

    updated.updated_at =
      options.touchUpdatedAt === false ? (data.updated_at ?? updated.updated_at) : new Date();
    this.events[eventIndex] = updated;
    return { ...updated };
  }
}

export class InMemoryReportIntakeRepository implements IReportIntakeRepository {
  private intakes: ReportIntake[] = [];
  private evidence: ReportIntakeEvidence[] = [];
  private intakeIdCounter = 0;
  private evidenceIdCounter = 0;

  private nextIntakeId(): string {
    this.intakeIdCounter += 1;
    return `intake-${this.intakeIdCounter}`;
  }

  private nextEvidenceId(): string {
    this.evidenceIdCounter += 1;
    return `evidence-${this.evidenceIdCounter}`;
  }

  async create(data: ReportIntakeCreate): Promise<ReportIntake> {
    const now = new Date();
    const intake: ReportIntake = {
      id: this.nextIntakeId(),
      server_id: data.serverId,
      reporter_id: data.reporterId,
      thread_id: data.threadId ?? null,
      status: data.status ?? ReportIntakeStatus.COLLECTING_EVIDENCE,
      summary: data.summary ?? null,
      confirmed_target_user_id: data.confirmedTargetUserId ?? null,
      created_at: now,
      updated_at: now,
      closed_at: null,
      metadata: (data.metadata ?? {}) as ReportIntake['metadata'],
    };
    this.intakes.push(intake);
    return { ...intake };
  }

  async findById(id: string): Promise<ReportIntake | null> {
    const intake = this.intakes.find((item) => item.id === id);
    return intake ? { ...intake } : null;
  }

  async findByThreadId(threadId: string): Promise<ReportIntake | null> {
    const intake = this.intakes.find((item) => item.thread_id === threadId);
    return intake ? { ...intake } : null;
  }

  async findOpenByThreadId(threadId: string): Promise<ReportIntake | null> {
    const intake = this.intakes.find(
      (item) =>
        item.thread_id === threadId &&
        [
          ReportIntakeStatus.COLLECTING_EVIDENCE,
          ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
          ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
        ].includes(item.status)
    );
    return intake ? { ...intake } : null;
  }

  async findOpenByReporterAndServer(
    serverId: string,
    reporterId: string
  ): Promise<ReportIntake | null> {
    const intake = this.intakes.find(
      (item) =>
        item.server_id === serverId &&
        item.reporter_id === reporterId &&
        [
          ReportIntakeStatus.COLLECTING_EVIDENCE,
          ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
          ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
        ].includes(item.status)
    );
    return intake ? { ...intake } : null;
  }

  async update(id: string, data: ReportIntakeUpdate): Promise<ReportIntake | null> {
    const index = this.intakes.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }

    const existing = this.intakes[index];
    const updated: ReportIntake = {
      ...existing,
      status: data.status ?? existing.status,
      summary: data.summary !== undefined ? data.summary : existing.summary,
      confirmed_target_user_id:
        data.confirmedTargetUserId !== undefined
          ? data.confirmedTargetUserId
          : existing.confirmed_target_user_id,
      closed_at: data.closedAt !== undefined ? data.closedAt : existing.closed_at,
      metadata:
        data.metadata !== undefined
          ? (data.metadata as ReportIntake['metadata'])
          : existing.metadata,
      updated_at: new Date(),
    };
    this.intakes[index] = updated;
    return { ...updated };
  }

  async confirmTargetIfUnset(
    id: string,
    data: { targetUserId: string; metadata: Record<string, unknown> }
  ): Promise<ReportIntake | null> {
    const index = this.intakes.findIndex(
      (item) =>
        item.id === id &&
        item.status === ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION &&
        item.confirmed_target_user_id === null
    );
    if (index === -1) {
      return null;
    }

    const updated: ReportIntake = {
      ...this.intakes[index],
      confirmed_target_user_id: data.targetUserId,
      metadata: data.metadata as ReportIntake['metadata'],
      updated_at: new Date(),
    };
    this.intakes[index] = updated;
    return { ...updated };
  }

  async addEvidence(data: ReportIntakeEvidenceCreate): Promise<ReportIntakeEvidence> {
    const evidence: ReportIntakeEvidence = {
      id: this.nextEvidenceId(),
      intake_id: data.intakeId,
      kind: data.kind,
      source_message_id: data.sourceMessageId ?? null,
      source_channel_id: data.sourceChannelId ?? null,
      attachment_id: data.attachmentId ?? null,
      content: data.content ?? null,
      metadata: (data.metadata ?? {}) as ReportIntakeEvidence['metadata'],
      created_at: new Date(),
    };
    this.evidence.push(evidence);
    return { ...evidence };
  }

  async listEvidence(intakeId: string): Promise<ReportIntakeEvidence[]> {
    return this.evidence.filter((item) => item.intake_id === intakeId).map((item) => ({ ...item }));
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
      case_role_id: data.case_role_id ?? null,
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
      case_role_active: data.case_role_active ?? existing?.case_role_active ?? false,
      last_verified_at: data.last_verified_at ?? existing?.last_verified_at ?? null,
      last_message_at: data.last_message_at ?? existing?.last_message_at ?? null,
      message_count: data.message_count ?? existing?.message_count ?? 0,
      verification_status:
        data.verification_status ?? existing?.verification_status ?? VerificationStatus.PENDING,
      last_status_change: data.last_status_change ?? existing?.last_status_change ?? null,
      discord_member_pending:
        data.discord_member_pending ?? existing?.discord_member_pending ?? false,
      discord_member_pending_since:
        data.discord_member_pending_since ?? existing?.discord_member_pending_since ?? null,
      discord_member_pending_cleared_at:
        data.discord_member_pending_cleared_at ??
        existing?.discord_member_pending_cleared_at ??
        null,
      discord_member_pending_last_checked_at:
        data.discord_member_pending_last_checked_at ??
        existing?.discord_member_pending_last_checked_at ??
        null,
      discord_member_pending_digest_sent_at:
        data.discord_member_pending_digest_sent_at ??
        existing?.discord_member_pending_digest_sent_at ??
        null,
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

  async findCaseRoleActiveMembers(serverId: string): Promise<ServerMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.server_id === serverId && member.case_role_active)
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

  async findLongPendingDiscordMembers(
    serverId: string,
    pendingSinceBefore: Date,
    limit = 100
  ): Promise<ServerMember[]> {
    return Array.from(this.members.values())
      .filter(
        (member) =>
          member.server_id === serverId &&
          member.discord_member_pending &&
          member.discord_member_pending_since !== null &&
          member.discord_member_pending_since.getTime() <= pendingSinceBefore.getTime()
      )
      .sort(
        (left, right) =>
          (left.discord_member_pending_since?.getTime() ?? 0) -
          (right.discord_member_pending_since?.getTime() ?? 0)
      )
      .slice(0, limit)
      .map((member) => ({ ...member }));
  }

  async findLongPendingDiscordMembersNeedingDigest(
    serverId: string,
    pendingSinceBefore: Date,
    limit = 25
  ): Promise<ServerMember[]> {
    return (await this.findLongPendingDiscordMembers(serverId, pendingSinceBefore, limit)).filter(
      (member) => member.discord_member_pending_digest_sent_at === null
    );
  }

  async markDiscordMemberPendingDigestSent(
    serverId: string,
    userIds: string[],
    sentAt: Date = new Date()
  ): Promise<number> {
    const userIdSet = new Set(userIds);
    let updatedCount = 0;
    for (const [key, member] of this.members.entries()) {
      if (member.server_id !== serverId || !userIdSet.has(member.user_id)) {
        continue;
      }
      this.members.set(key, {
        ...member,
        discord_member_pending_digest_sent_at: sentAt,
        discord_member_pending_last_checked_at: sentAt,
      });
      updatedCount += 1;
    }
    return updatedCount;
  }

  async updateCaseRoleStatus(
    serverId: string,
    userId: string,
    caseRoleActive: boolean,
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
      case_role_active: caseRoleActive,
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
      case_role_active: false,
      reputation_score: 0,
      verification_status: VerificationStatus.PENDING,
      discord_member_pending: false,
    });
  }

  async updateDiscordMemberPendingState(
    serverId: string,
    userId: string,
    pending: boolean,
    observedAt: Date = new Date()
  ): Promise<{
    member: ServerMember;
    wasPending: boolean;
    isPending: boolean;
    pendingChanged: boolean;
  } | null> {
    const existing = this.members.get(this.key(serverId, userId));
    if (!existing) {
      return null;
    }

    const wasPending = existing.discord_member_pending === true;
    const updated: ServerMember = {
      ...existing,
      discord_member_pending: pending,
      discord_member_pending_since: pending
        ? (existing.discord_member_pending_since ?? observedAt)
        : null,
      discord_member_pending_cleared_at:
        !pending && wasPending ? observedAt : existing.discord_member_pending_cleared_at,
      discord_member_pending_last_checked_at: observedAt,
      discord_member_pending_digest_sent_at:
        pending && !wasPending ? null : existing.discord_member_pending_digest_sent_at,
    };
    this.members.set(this.key(serverId, userId), updated);
    return {
      member: { ...updated },
      wasPending,
      isPending: pending,
      pendingChanged: wasPending !== pending,
    };
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
      detection_event_id: data.detection_event_id ?? null,
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

export class InMemoryModerationOutcomeRepository implements IModerationOutcomeRepository {
  private outcomes: ModerationOutcome[] = [];
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `out-${this.idCounter}`;
  }

  async createOutcome(data: ModerationOutcomeCreate): Promise<ModerationOutcome> {
    const outcome: ModerationOutcome = {
      id: this.nextId(),
      server_id: data.server_id,
      user_id: data.user_id,
      detection_event_id: data.detection_event_id ?? null,
      verification_event_id: data.verification_event_id ?? null,
      outcome_type: data.outcome_type,
      source: data.source,
      actor_id: data.actor_id ?? null,
      reason: data.reason ?? null,
      occurred_at: data.occurred_at ?? new Date(),
      created_at: new Date(),
      metadata: data.metadata ?? null,
    };
    this.outcomes.push(outcome);
    return { ...outcome };
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ModerationOutcome[]> {
    const filtered = this.outcomes
      .filter((outcome) => outcome.user_id === userId && outcome.server_id === serverId)
      .sort((a, b) => toTimestamp(b.occurred_at) - toTimestamp(a.occurred_at));
    const start = options.offset ?? 0;
    const end = options.limit ? start + options.limit : undefined;
    return filtered.slice(start, end).map((outcome) => ({ ...outcome }));
  }

  async findLatestByTypeForUserAndServer(
    userId: string,
    serverId: string,
    outcomeType: ModerationOutcomeType
  ): Promise<ModerationOutcome | null> {
    const outcome = [...this.outcomes]
      .sort((a, b) => toTimestamp(b.occurred_at) - toTimestamp(a.occurred_at))
      .find(
        (item) =>
          item.user_id === userId &&
          item.server_id === serverId &&
          item.outcome_type === outcomeType
      );

    return outcome ? { ...outcome } : null;
  }

  async findByVerificationEvent(verificationEventId: string): Promise<ModerationOutcome[]> {
    return this.outcomes
      .filter((outcome) => outcome.verification_event_id === verificationEventId)
      .sort((a, b) => toTimestamp(b.occurred_at) - toTimestamp(a.occurred_at))
      .map((outcome) => ({ ...outcome }));
  }
}

export class InMemoryRoleQuarantineSnapshotRepository implements IRoleQuarantineSnapshotRepository {
  private snapshots: RoleQuarantineSnapshot[] = [];
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `role-quarantine-${this.idCounter}`;
  }

  async create(data: RoleQuarantineSnapshotCreate): Promise<RoleQuarantineSnapshot> {
    const now = new Date();
    const snapshot: RoleQuarantineSnapshot = {
      id: this.nextId(),
      server_id: data.serverId,
      user_id: data.userId,
      verification_event_id: data.verificationEventId ?? null,
      status: RoleQuarantineSnapshotStatus.ACTIVE,
      mode: data.mode,
      original_role_ids: [...data.originalRoleIds],
      planned_role_ids: [...data.plannedRoleIds],
      removed_role_ids: [...(data.removedRoleIds ?? [])],
      restored_role_ids: [...(data.restoredRoleIds ?? [])],
      skipped_roles: data.skippedRoles ?? [],
      failed_removals: data.failedRemovals ?? [],
      failed_restores: data.failedRestores ?? [],
      created_at: now,
      updated_at: now,
      restored_at: null,
      restored_by: null,
      metadata: data.metadata ?? {},
    };
    this.snapshots.push(snapshot);
    return this.clone(snapshot);
  }

  async findActiveByServerAndUser(
    serverId: string,
    userId: string
  ): Promise<RoleQuarantineSnapshot | null> {
    const snapshots = this.snapshots
      .filter(
        (item) =>
          item.server_id === serverId &&
          item.user_id === userId &&
          item.status === RoleQuarantineSnapshotStatus.ACTIVE
      )
      .sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
    if (snapshots.length === 0) {
      return null;
    }

    return this.clone(snapshots[0]);
  }

  async update(
    id: string,
    data: RoleQuarantineSnapshotUpdate
  ): Promise<RoleQuarantineSnapshot | null> {
    const index = this.snapshots.findIndex((snapshot) => snapshot.id === id);
    if (index === -1) {
      return null;
    }

    const existing = this.snapshots[index];
    const updated: RoleQuarantineSnapshot = {
      ...existing,
      status: data.status ?? existing.status,
      removed_role_ids: data.removedRoleIds ? [...data.removedRoleIds] : existing.removed_role_ids,
      restored_role_ids: data.restoredRoleIds
        ? [...data.restoredRoleIds]
        : existing.restored_role_ids,
      skipped_roles: data.skippedRoles === undefined ? existing.skipped_roles : data.skippedRoles,
      failed_removals:
        data.failedRemovals === undefined ? existing.failed_removals : data.failedRemovals,
      failed_restores:
        data.failedRestores === undefined ? existing.failed_restores : data.failedRestores,
      restored_at: data.restoredAt === undefined ? existing.restored_at : data.restoredAt,
      restored_by: data.restoredBy === undefined ? existing.restored_by : data.restoredBy,
      metadata: data.metadata === undefined ? existing.metadata : data.metadata,
      updated_at: new Date(),
    };
    this.snapshots[index] = updated;
    return this.clone(updated);
  }

  private clone(snapshot: RoleQuarantineSnapshot): RoleQuarantineSnapshot {
    return {
      ...snapshot,
      original_role_ids: [...snapshot.original_role_ids],
      planned_role_ids: [...snapshot.planned_role_ids],
      removed_role_ids: [...snapshot.removed_role_ids],
      restored_role_ids: [...snapshot.restored_role_ids],
    };
  }
}
