import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  workflowDefinitions,
  settingsSectionSchemas,
  type WorkflowId,
  type AccessBinding,
  type AccessDecision,
  type AccessDenial,
  type DelegatedAccess,
  type DelegatedPrincipal,
  type ResourceReadQuery,
} from '@drasil/application';
import { decodeSignedJson, encodeSignedJson } from '../crypto';
import { withAuthorizedRead } from './access';
import { boundValue, MCP_RESULT_BYTES, queryResultBytes, type JsonRecord } from './results';

const snowflake = z.string().regex(/^\d{17,20}$/);
const uuid = z.string().uuid();
const base = { guildId: snowflake };
const page = {
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
};
const audience = z.enum(['staff', 'reporter']).default('staff');
const caseStatus = z.enum(['pending', 'verified', 'banned', 'kicked', 'closed_no_action']);
const reportStatus = z.enum([
  'collecting_evidence',
  'needs_reporter_confirmation',
  'needs_admin_confirmation',
  'submitted',
  'actioned',
  'dismissed',
  'false_positive',
  'closed_by_reporter',
  'expired',
]);
const workflowId = z.enum(
  workflowDefinitions.map((item) => item.id) as [WorkflowId, ...WorkflowId[]]
);
export const querySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list_guilds'), ...page }).strict(),
  z.object({ kind: z.literal('get_capabilities'), ...base }).strict(),
  z
    .object({
      kind: z.literal('list_cases'),
      ...base,
      ...page,
      status: caseStatus.optional(),
      userId: snowflake.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('get_case'), ...base, caseId: uuid }).strict(),
  z
    .object({
      kind: z.literal('list_case_history'),
      ...base,
      ...page,
      caseId: uuid,
      history: z.enum(['outcomes', 'detections']).default('outcomes'),
    })
    .strict(),
  z
    .object({ kind: z.literal('list_detections'), ...base, ...page, userId: snowflake.optional() })
    .strict(),
  z.object({ kind: z.literal('get_detection'), ...base, detectionId: uuid }).strict(),
  z
    .object({
      kind: z.literal('list_reports'),
      ...base,
      ...page,
      audience,
      status: reportStatus.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('get_report'), ...base, reportId: uuid, audience }).strict(),
  z
    .object({ kind: z.literal('list_report_evidence'), ...base, ...page, reportId: uuid, audience })
    .strict(),
  z
    .object({
      kind: z.literal('get_intake'),
      ...base,
      intakeId: uuid,
      audience: z.enum(['staff', 'reporter']).default('reporter'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('get_member_context'),
      ...base,
      userId: snowflake,
      purpose: z.enum(['report', 'case', 'ban', 'kick', 'configure']),
      workflowId,
    })
    .strict(),
  z.object({ kind: z.literal('list_attention'), ...base, ...page }).strict(),
  z.object({ kind: z.literal('get_setup'), ...base }).strict(),
  z.object({ kind: z.literal('get_diagnostics'), ...base }).strict(),
  z
    .object({
      kind: z.literal('get_message_context'),
      ...base,
      ...page,
      channelId: snowflake,
      messageId: snowflake.optional(),
    })
    .strict(),
]);
export type McpQuery = z.infer<typeof querySchema>;
export type ResourceQuery = Exclude<McpQuery, { kind: 'list_guilds' | 'get_capabilities' }>;
export interface PageKey {
  readonly id: string;
  readonly timestamp: string | null;
}
export interface QueryRow {
  readonly key: PageKey;
  readonly value: JsonRecord;
}
export interface QueryRepository {
  read(
    binding: AccessBinding,
    query: ResourceQuery,
    after: PageKey | null
  ): Promise<readonly QueryRow[]>;
}
export type QueryResult =
  | AccessDenial
  | {
      readonly kind: 'allowed';
      readonly items: JsonRecord[];
      readonly nextCursor: string | null;
      readonly truncated: boolean;
    };
export interface McpQueryDependencies {
  readonly intakeChoices?: (
    principal: DelegatedPrincipal,
    guildId: string,
    intakeId: string
  ) => Promise<{ reference: string; candidateIds: readonly string[] } | null>;
  readonly access: DelegatedAccess;
  readonly repository: QueryRepository;
  readonly cursorSecret: string;
  readonly guildLabel?: (guildId: string) => Promise<string>;
  readonly authorizeDiscordContent: (
    principal: DelegatedPrincipal,
    guildId: string,
    channelId: string
  ) => Promise<AccessDecision>;
  readonly messages: (
    query: Extract<McpQuery, { kind: 'get_message_context' }>,
    after: PageKey | null
  ) => Promise<readonly QueryRow[]>;
}
export function queryPolicy(query: ResourceQuery): ResourceReadQuery {
  const guildId = query.guildId;
  switch (query.kind) {
    case 'list_cases':
    case 'get_case':
    case 'list_case_history':
    case 'get_message_context':
      return { kind: 'cases', guildId };
    case 'list_detections':
    case 'get_detection':
      return { kind: 'detections', guildId };
    case 'list_reports':
    case 'get_report':
    case 'list_report_evidence':
      return { kind: 'reports', guildId, audience: query.audience };
    case 'get_intake':
      return { kind: 'intakes', guildId, audience: query.audience };
    case 'get_member_context':
      return {
        kind: 'member_context',
        guildId,
        purpose: query.purpose,
        workflowId: query.workflowId,
      };
    case 'list_attention':
      return { kind: 'attention', guildId };
    case 'get_setup':
      return { kind: 'setup', guildId };
    case 'get_diagnostics':
      return { kind: 'diagnostics', guildId };
  }
}
const fields = {
  cases: [
    'id',
    'userId',
    'status',
    'caseKind',
    'attentionState',
    'containmentStatus',
    'revision',
    'detectionEventId',
    'captchaChallengeId',
    'captchaGeneration',
    'captchaStatus',
    'captchaExpiresAt',
    'notes',
    'createdAt',
    'updatedAt',
    'resolvedAt',
  ],
  detections: [
    'id',
    'userId',
    'type',
    'confidence',
    'reasons',
    'detectedAt',
    'messageId',
    'channelId',
  ],
  reports: [
    'id',
    'status',
    'reporterId',
    'targetUserId',
    'summary',
    'createdAt',
    'updatedAt',
    'closedAt',
  ],
  intake: ['id', 'status', 'createdAt', 'updatedAt', 'closedAt'],
  evidence: [
    'id',
    'kind',
    'content',
    'sourceMessageId',
    'sourceChannelId',
    'attachmentId',
    'attachments',
    'createdAt',
  ],
  member: ['userId', 'username', 'joinedAt', 'accountCreatedAt'],
} as const;
function project(query: ResourceQuery, binding: AccessBinding, value: JsonRecord): JsonRecord {
  let keys: readonly string[];
  switch (query.kind) {
    case 'list_cases':
    case 'get_case':
      keys = fields.cases;
      break;
    case 'list_case_history':
      keys =
        query.history === 'detections'
          ? fields.detections
          : ['id', 'type', 'source', 'actorId', 'reason', 'occurredAt'];
      break;
    case 'list_detections':
    case 'get_detection':
      keys = fields.detections;
      break;
    case 'list_reports':
    case 'get_report':
      keys = binding.reporterId ? fields.intake : fields.reports;
      break;
    case 'get_intake':
      keys = fields.intake;
      break;
    case 'list_report_evidence':
      keys = fields.evidence;
      break;
    case 'get_member_context':
      keys =
        binding.memberContext?.purpose === 'report'
          ? fields.member
          : [...fields.member, 'verificationStatus', 'caseRoleActive', 'lastVerifiedAt'];
      break;
    case 'list_attention':
      keys = ['id', 'userId', 'type', 'createdAt', 'updatedAt'];
      break;
    case 'get_setup':
      keys = [
        'guildId',
        'settings',
        'caseRoleId',
        'adminChannelId',
        'verificationChannelId',
        'adminNotificationRoleId',
        'heuristicMessageThreshold',
        'heuristicMessageTimeframeSeconds',
        'heuristicSuspiciousKeywords',
        'active',
      ];
      break;
    case 'get_diagnostics':
      keys = ['checkedAt', 'lookbackDays', 'candidateCounts'];
      break;
    case 'get_message_context':
      keys = ['id', 'channelId', 'authorId', 'authorName', 'content', 'timestamp', 'attachments'];
      break;
  }
  const projected = Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]])
  );
  if (Array.isArray(projected.attachments))
    projected.attachments = projected.attachments.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
      return Object.fromEntries(
        ['id', 'filename', 'contentType', 'size']
          .filter((key) => key in item)
          .map((key) => [key, item[key]])
      );
    });
  if (query.kind === 'get_setup') {
    const settings = projected.settings;
    const allowedKeys = new Set(
      Object.values(settingsSectionSchemas).flatMap((schema) => Object.keys(schema.shape))
    );
    projected.settings =
      settings && typeof settings === 'object' && !Array.isArray(settings)
        ? Object.fromEntries(Object.entries(settings).filter(([key]) => allowedKeys.has(key)))
        : {};
  }
  return projected;
}
const keySchema = z
  .object({ id: z.string().min(1).max(64), timestamp: z.string().max(64).nullable() })
  .strict();
const cursorSchema = z
  .object({ v: z.literal(1), binding: z.string().length(64), key: keySchema })
  .strict();
function cursorBinding(principal: DelegatedPrincipal, query: McpQuery): string {
  const normalized = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'cursor'));
  return createHash('sha256')
    .update(
      JSON.stringify([
        principal.userId,
        principal.clientId,
        principal.connectionId,
        principal.grantVersion,
        [...principal.scopes].sort(),
        normalized,
      ])
    )
    .digest('hex');
}

function paginate(
  rows: readonly QueryRow[],
  limit: number,
  sign: (key: PageKey) => string,
  continuation: PageKey | null = null
): Extract<QueryResult, { kind: 'allowed' }> {
  const result: Extract<QueryResult, { kind: 'allowed' }> = {
    kind: 'allowed',
    items: [],
    nextCursor: null,
    truncated: false,
  };
  const items: JsonRecord[] = [];
  let truncated = false;
  let remainingAttachments = 10;
  let nextCursor: string | null = rows.length === 0 && continuation ? sign(continuation) : null;
  for (let index = 0; index < Math.min(rows.length, limit); index++) {
    const row = rows[index];
    const bounded = boundValue(row.value, 4000, 100, remainingAttachments);
    let attachmentCount = bounded.attachmentCount;
    const cursor = index < rows.length - 1 || continuation ? sign(row.key) : null;
    const candidate = {
      ...result,
      items: [...items, bounded.value as JsonRecord],
      nextCursor: cursor,
      truncated: truncated || bounded.truncated,
    };
    if (queryResultBytes(candidate) > MCP_RESULT_BYTES && items.length > 0) {
      truncated = true;
      break;
    }
    let item = bounded.value as JsonRecord;
    // A single large row must make progress. Only this row's optional text/arrays shrink.
    for (
      let budget = 2000;
      queryResultBytes({ ...candidate, items: [...items, item], truncated: true }) >
      MCP_RESULT_BYTES;
      budget = Math.floor(budget / 2)
    ) {
      if (budget < 1) throw new Error('Unbounded query record');
      const reduced = boundValue(
        item,
        budget,
        Math.max(1, Math.floor(budget / 40)),
        remainingAttachments
      );
      item = reduced.value as JsonRecord;
      attachmentCount = reduced.attachmentCount;
      truncated = true;
    }
    items.push(item);
    remainingAttachments -= attachmentCount;
    nextCursor = cursor;
    truncated ||= bounded.truncated;
  }
  return { ...result, items, nextCursor, truncated };
}
export function createMcpQueries(deps: McpQueryDependencies): {
  execute(principal: DelegatedPrincipal, input: unknown): Promise<QueryResult>;
} {
  if (deps.cursorSecret.trim().length < 32)
    throw new Error('MCP cursor secret must have at least 32 characters.');
  return {
    async execute(principal, input) {
      const parsed = querySchema.safeParse(input);
      if (!parsed.success) return { kind: 'denied', reason: 'invalid_page' };
      const query = parsed.data;
      const bindingHash = cursorBinding(principal, query);
      let after: PageKey | null = null;
      if ('cursor' in query && query.cursor) {
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(query.cursor))
          return { kind: 'denied', reason: 'invalid_page' };
        const decoded = cursorSchema.safeParse(decodeSignedJson(query.cursor, deps.cursorSecret));
        if (!decoded.success || decoded.data.binding !== bindingHash)
          return { kind: 'denied', reason: 'invalid_page' };
        after = decoded.data.key;
      }
      const sign = (key: PageKey) =>
        encodeSignedJson({ v: 1, binding: bindingHash, key }, deps.cursorSecret);
      try {
        if (query.kind === 'get_capabilities') {
          const decision = await deps.access.getCapabilities(principal, query.guildId);
          if (decision.kind === 'denied') return decision;
          const capabilities = decision.capabilities;
          return paginate(
            [
              {
                key: { id: query.guildId, timestamp: null },
                value: {
                  ...capabilities,
                  memberContext: capabilities.memberContext.map((pair) => ({ ...pair })),
                  reads: [...capabilities.reads],
                  scopes: [...capabilities.scopes],
                  workflows: [...capabilities.workflows],
                },
              },
            ],
            1,
            sign
          );
        }
        if (query.kind === 'list_guilds') {
          const page = await deps.access.listEligibleGuilds(principal, {
            limit: query.limit,
            cursor: after?.id ?? null,
          });
          if (page.kind === 'denied') return page;
          const rows: QueryRow[] = [];
          for (const guild of page.guilds)
            rows.push({
              key: { id: guild.guildId, timestamp: null },
              value: {
                guildId: guild.guildId,
                name: deps.guildLabel ? await deps.guildLabel(guild.guildId) : guild.guildId,
                reads: [...guild.reads],
                scopes: [...guild.scopes],
                workflows: [...guild.workflows],
                memberContext: guild.memberContext.map((pair) => ({ ...pair })),
              },
            });
          return paginate(
            rows,
            query.limit,
            sign,
            page.nextCursor ? { id: page.nextCursor, timestamp: null } : null
          );
        }
        const authorized = await withAuthorizedRead(
          deps.access,
          principal,
          queryPolicy(query),
          async (binding) => {
            if (
              query.kind === 'get_member_context' &&
              (binding.memberContext?.workflowId !== query.workflowId ||
                binding.memberContext.purpose !== query.purpose)
            )
              return { kind: 'denied', reason: 'binding_mismatch' } as const;
            let rows: readonly QueryRow[];
            if (query.kind === 'get_message_context') {
              const visibility = await deps.authorizeDiscordContent(
                principal,
                query.guildId,
                query.channelId
              );
              if (visibility.kind === 'denied') return visibility;
              rows = await deps.messages(query, after);
            } else rows = await deps.repository.read(binding, query, after);
            const projected = rows.map((row) => ({
              ...row,
              value: project(query, binding, row.value),
            }));
            if (query.kind === 'get_intake' && projected.length === 1 && deps.intakeChoices) {
              const choice = await deps.intakeChoices(
                principal,
                query.guildId,
                String(projected[0].value.id)
              );
              if (choice)
                projected[0] = {
                  ...projected[0],
                  value: {
                    ...projected[0].value,
                    candidateIds: [...choice.candidateIds],
                    intakePromptReference: choice.reference,
                  },
                };
            }
            return paginate(projected, 'limit' in query ? query.limit : 1, sign);
          }
        );
        return authorized.kind === 'denied' ? authorized : authorized.value;
      } catch {
        return { kind: 'denied', reason: 'unavailable' };
      }
    },
  };
}
