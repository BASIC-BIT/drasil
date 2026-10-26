import type { Pool } from 'pg';
import type { AccessBinding } from '@drasil/application';
import {
  createSetupDataAdapter,
  getPostgresPool,
  type SetupDataAdapter,
} from '../../setupDataAdapter';
import {
  PostgresOperationsIntegrityDataAdapter,
  type OperationsIntegrityDataAdapter,
} from '../../operationsIntegrityDataAdapter';
import { fetchBotMessage, fetchBotMessagePage } from '../../discordApi';
import type { McpQuery, ResourceQuery, PageKey, QueryRepository, QueryRow } from '../queries';
import type { JsonRecord } from '../results';

interface Dependencies {
  readonly database?: Pick<Pool, 'query'>;
  readonly setup?: Pick<SetupDataAdapter, 'getServer'>;
  readonly diagnostics?: OperationsIntegrityDataAdapter;
}
interface SqlRow {
  id: string;
  timestamp: string | null;
  value: JsonRecord;
}
// Expressions and field names are fixed code. All caller-controlled values use parameters.
const caseFields = {
  id: 've.id',
  userId: 've.user_id',
  status: 've.status',
  caseKind: 've.case_kind',
  attentionState: 've.attention_state',
  containmentStatus: 've.containment_status',
  revision: 've.case_revision',
  detectionEventId: 've.detection_event_id',
  captchaChallengeId: 'cc.id',
  captchaGeneration: 'cc.generation',
  captchaStatus: 'cc.status',
  captchaExpiresAt: 'cc.expires_at',
  notes: 've.notes',
  createdAt: 've.created_at',
  updatedAt: 've.updated_at',
  resolvedAt: 've.resolved_at',
};
const detectionFields = {
  id: 'de.id',
  userId: 'de.user_id',
  type: 'de.detection_type',
  confidence: 'de.confidence',
  reasons: 'de.reasons',
  detectedAt: 'de.detected_at',
  messageId: 'de.message_id',
  channelId: 'de.channel_id',
};
const intakeFields = {
  id: 'ri.id',
  status: 'ri.status',
  createdAt: 'ri.created_at',
  updatedAt: 'ri.updated_at',
  closedAt: 'ri.closed_at',
};
function jsonFields(fields: Record<string, string>): string {
  return `jsonb_build_object(${Object.entries(fields)
    .flatMap(([key, expression]) => [`'${key}'`, expression])
    .join(',')})`;
}
function sqlSource(
  binding: AccessBinding,
  query: ResourceQuery,
  bind: (value: unknown) => string
): { sql: string; ascending: boolean } {
  const guild = bind(binding.guildId);
  const select = (
    table: string,
    alias: string,
    timestamp: string,
    fields: Record<string, string>,
    predicates: string[],
    joins = ''
  ) => ({
    sql: `select ${alias}.id, ${timestamp} as sort_at, ${jsonFields(fields)} as value from ${table} ${alias} ${joins} where ${predicates.join(' and ')}`,
    ascending: false,
  });
  switch (query.kind) {
    case 'list_cases':
    case 'get_case': {
      const predicates = [`ve.server_id=${guild}`, 've.user_id is not null'];
      if (query.kind === 'get_case') predicates.push(`ve.id=${bind(query.caseId)}::uuid`);
      else {
        if (query.userId) predicates.push(`ve.user_id=${bind(query.userId)}`);
        if (query.status) predicates.push(`ve.status=${bind(query.status)}::verification_status`);
      }
      return select(
        'verification_events',
        've',
        've.updated_at',
        caseFields,
        predicates,
        'left join captcha_challenges cc on cc.verification_event_id=ve.id and cc.server_id=ve.server_id and cc.user_id=ve.user_id'
      );
    }
    case 'list_detections':
    case 'get_detection': {
      const predicates = [`de.server_id=${guild}`];
      if (query.kind === 'get_detection') predicates.push(`de.id=${bind(query.detectionId)}::uuid`);
      else if (query.userId) predicates.push(`de.user_id=${bind(query.userId)}`);
      return select('detection_events', 'de', 'de.detected_at', detectionFields, predicates);
    }
    case 'list_case_history': {
      const parent = bind(query.caseId);
      if (query.history === 'detections')
        return select(
          'detection_events',
          'de',
          'de.detected_at',
          detectionFields,
          [`de.server_id=${guild}`, `ve.server_id=${guild}`, `ve.id=${parent}::uuid`],
          'join verification_events ve on (ve.detection_event_id=de.id or de.latest_verification_event_id=ve.id)'
        );
      return select(
        'moderation_outcomes',
        'mo',
        'mo.occurred_at',
        {
          id: 'mo.id',
          type: 'mo.outcome_type',
          source: 'mo.source',
          actorId: 'mo.actor_id',
          reason: 'mo.reason',
          occurredAt: 'mo.occurred_at',
        },
        [`mo.server_id=${guild}`, `ve.server_id=${guild}`, `ve.id=${parent}::uuid`],
        'join verification_events ve on ve.id=mo.verification_event_id'
      );
    }
    case 'list_reports':
    case 'get_report':
    case 'get_intake': {
      const predicates = [`ri.server_id=${guild}`];
      if (binding.reporterId) predicates.push(`ri.reporter_id=${bind(binding.reporterId)}`);
      if (query.kind === 'get_report') predicates.push(`ri.id=${bind(query.reportId)}::uuid`);
      if (query.kind === 'get_intake') predicates.push(`ri.id=${bind(query.intakeId)}::uuid`);
      if (query.kind === 'list_reports' && query.status)
        predicates.push(`ri.status=${bind(query.status)}::report_intake_status`);
      const fields =
        binding.reporterId || query.kind === 'get_intake'
          ? intakeFields
          : {
              ...intakeFields,
              reporterId: 'ri.reporter_id',
              targetUserId: 'ri.confirmed_target_user_id',
              summary: 'ri.summary',
            };
      return select('report_intakes', 'ri', 'ri.updated_at', fields, predicates);
    }
    case 'list_report_evidence': {
      const predicates = [`ri.server_id=${guild}`, `ri.id=${bind(query.reportId)}::uuid`];
      if (binding.reporterId) {
        const reporter = bind(binding.reporterId);
        // Only proven reporter-authored input is reporter-visible. Staff notes, extracted
        // assessments and candidate/admin confirmation facts remain staff evidence.
        predicates.push(
          `ri.reporter_id=${reporter}`,
          `rie.metadata->>'author_id'=${reporter}`,
          `rie.kind in ('reporter_text','screenshot','message_link')`
        );
      }
      return {
        ...select(
          'report_intake_evidence',
          'rie',
          'rie.created_at',
          {
            id: 'rie.id',
            kind: 'rie.kind',
            content: 'rie.content',
            sourceMessageId: 'rie.source_message_id',
            sourceChannelId: 'rie.source_channel_id',
            attachmentId: 'rie.attachment_id',
            createdAt: 'rie.created_at',
            attachments: `case when rie.attachment_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',rie.attachment_id,'filename',rie.metadata->>'name','contentType',rie.metadata->>'contentType','size',case when jsonb_typeof(rie.metadata->'size')='number' then rie.metadata->'size' else null end)) end`,
          },
          predicates,
          'join report_intakes ri on ri.id=rie.intake_id'
        ),
        ascending: true,
      };
    }
    case 'get_member_context': {
      if (
        binding.memberContext?.purpose !== query.purpose ||
        binding.memberContext.workflowId !== query.workflowId
      )
        throw new Error('Missing member context binding');
      const fields = {
        userId: 'sm.user_id',
        username: 'u.username',
        joinedAt: 'sm.join_date',
        accountCreatedAt: 'u.account_created_at',
        ...(query.purpose === 'report'
          ? {}
          : {
              verificationStatus: 'sm.verification_status',
              caseRoleActive: 'sm.case_role_active',
              lastVerifiedAt: 'sm.last_verified_at',
            }),
      };
      return {
        sql: `select sm.user_id as id, sm.join_date as sort_at,${jsonFields(fields)} as value from server_members sm join users u on u.discord_id=sm.user_id where sm.server_id=${guild} and sm.user_id=${bind(query.userId)}`,
        ascending: false,
      };
    }
    case 'list_attention':
      return select(
        'moderation_queue_items',
        'mqi',
        'mqi.updated_at',
        {
          id: 'mqi.id',
          userId: 'mqi.user_id',
          type: 'mqi.item_type',
          createdAt: 'mqi.created_at',
          updatedAt: 'mqi.updated_at',
        },
        [`mqi.server_id=${guild}`]
      );
    default:
      throw new Error('Query does not use a paginated SQL source');
  }
}
export function createPostgresQueryRepository(deps: Dependencies = {}): QueryRepository {
  return {
    async read(binding, query, after) {
      if (binding.guildId !== query.guildId) throw new Error('Guild binding mismatch');
      if (
        'audience' in query &&
        query.audience === 'reporter' &&
        binding.reporterId !== binding.facts.userId
      )
        throw new Error('Missing reporter binding');
      if (query.kind === 'get_setup') {
        const server = await (deps.setup ?? createSetupDataAdapter()).getServer(binding.guildId);
        if (!server) return [];
        return [
          {
            key: { id: binding.guildId, timestamp: null },
            value: {
              guildId: server.guild_id,
              settings: server.settings as JsonRecord,
              caseRoleId: server.case_role_id,
              adminChannelId: server.admin_channel_id,
              verificationChannelId: server.verification_channel_id,
              adminNotificationRoleId: server.admin_notification_role_id,
              heuristicMessageThreshold: server.heuristic_message_threshold,
              heuristicMessageTimeframeSeconds: server.heuristic_message_timeframe_seconds,
              heuristicSuspiciousKeywords: server.heuristic_suspicious_keywords,
              active: server.is_active,
            },
          },
        ];
      }
      if (query.kind === 'get_diagnostics') {
        const snapshot = await (
          deps.diagnostics ?? new PostgresOperationsIntegrityDataAdapter()
        ).getSnapshot(binding.guildId);
        return [
          {
            key: { id: binding.guildId, timestamp: null },
            value: {
              checkedAt: snapshot.checkedAt,
              lookbackDays: snapshot.lookbackDays,
              candidateCounts: { ...snapshot.candidateCounts },
            },
          },
        ];
      }
      const values: unknown[] = [];
      const bind = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      const source = sqlSource(binding, query, bind);
      let predicate = 'true';
      if (after) {
        const id = bind(after.id);
        const operator = source.ascending ? '>' : '<';
        predicate =
          after.timestamp === null
            ? `sort_at is null and id ${operator} ${id}::uuid`
            : `(sort_at is null or sort_at ${operator} ${bind(after.timestamp)}::timestamptz or (sort_at=${bind(after.timestamp)}::timestamptz and id ${operator} ${id}::uuid))`;
      }
      const order = source.ascending ? 'asc' : 'desc';
      const limit = bind('limit' in query ? query.limit + 1 : 1);
      // The cursor key comes from PostgreSQL text, never pg's millisecond Date conversion.
      const sql = `with source as (${source.sql}) select id,to_char(sort_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as timestamp,value from source where ${predicate} order by sort_at ${order} nulls last,id ${order} limit ${limit}`;
      const rows = await (deps.database ?? getPostgresPool()).query<SqlRow>(sql, values);
      return rows.rows.map((row) => ({
        key: { id: row.id, timestamp: row.timestamp },
        value: row.value,
      }));
    },
  };
}
/** Called only after fresh Drasil and actor/bot visibility decisions. */
export async function readDiscordMessages(
  query: Extract<McpQuery, { kind: 'get_message_context' }>,
  after: PageKey | null
): Promise<readonly QueryRow[]> {
  if (query.messageId && after) throw new Error('A single message has no continuation');
  const messages = query.messageId
    ? [await fetchBotMessage(query.channelId, query.messageId)]
    : await fetchBotMessagePage(query.channelId, Math.min(100, query.limit + 1), after?.id ?? null);
  if (!query.messageId && query.limit === 100 && messages.length === 100)
    messages.push(...(await fetchBotMessagePage(query.channelId, 1, messages[99].id)));
  if (
    messages.some(
      (message) =>
        message.channel_id !== query.channelId ||
        (query.messageId && message.id !== query.messageId) ||
        !/^\d{17,20}$/.test(message.id)
    )
  )
    throw new Error('Message binding mismatch');
  return messages.map((message) => ({
    key: { id: message.id, timestamp: null },
    value: {
      id: message.id,
      channelId: message.channel_id,
      authorId: message.author.id,
      authorName: message.author.global_name ?? message.author.username,
      content: message.content,
      timestamp: message.timestamp,
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename ?? null,
        contentType: attachment.content_type ?? null,
        size: attachment.size ?? null,
      })),
    },
  }));
}
