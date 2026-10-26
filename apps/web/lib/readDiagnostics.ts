import { currentReadRequestContext } from './readRequestContext';

const operations = new Set([
  'mcp_http',
  'selected_workspace_read',
  'list_guilds',
  'get_capabilities',
  'list_cases',
  'get_case',
  'list_case_history',
  'list_detections',
  'get_detection',
  'list_reports',
  'get_report',
  'list_report_evidence',
  'get_intake',
  'get_member_context',
  'list_attention',
  'get_setup',
  'get_diagnostics',
  'get_message_context',
]);
const dependencies = ['discord', 'postgres', 'internal'] as const;
const categories = [
  'success',
  'http_rate_limited',
  'http_server_error',
  'http_client_error',
  'network',
  'aborted',
  'invalid_response',
  'database_connection',
  'database_capacity',
  'database_query',
  'unknown',
] as const;
const boundaries = ['discord_get', 'authority', 'visibility', 'query'] as const;
const sqlStates = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '53300',
  '53400',
  '53200',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  '40001',
  '40P01',
  '23505',
  '42501',
  '42P01',
  '42703',
  '42601',
]);
export interface ReadDependencyEvent {
  readonly dependency: (typeof dependencies)[number];
  readonly category: (typeof categories)[number];
  readonly boundary: (typeof boundaries)[number];
  readonly source?: 'identity' | 'guild' | 'member' | 'roles';
  readonly status: number | null;
  /** Null when a swallowed application exception has no boundary timing. */
  readonly latencyMs: number | null;
  readonly attempt: number;
  readonly sqlState?: string;
}
export function classifyReadFailure(
  error: unknown
): Pick<ReadDependencyEvent, 'dependency' | 'category' | 'status' | 'sqlState'> {
  try {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (typeof code === 'string' && sqlStates.has(code)) {
      return {
        dependency: 'postgres',
        category:
          code.startsWith('08') || code.startsWith('57P')
            ? 'database_connection'
            : code.startsWith('53')
              ? 'database_capacity'
              : 'database_query',
        status: null,
        sqlState: code,
      };
    }
  } catch {
    // An unreadable error is still an unknown failure, never a diagnostic exception.
  }
  return { dependency: 'internal', category: 'unknown', status: null };
}

/** Select each field explicitly; never serialize an Error or backend object. */
export function recordReadDependency(
  event: ReadDependencyEvent,
  sink: (line: string) => void = (line) => console.info(line)
): void {
  try {
    const context = currentReadRequestContext();
    if (!context) return;
    sink(
      JSON.stringify({
        event: 'read_dependency',
        correlationId: context.correlationId,
        operation: operations.has(context.operation) ? context.operation : 'unknown',
        ...(event.source && ['identity', 'guild', 'member', 'roles'].includes(event.source)
          ? { source: event.source }
          : {}),
        dependency: dependencies.includes(event.dependency) ? event.dependency : 'internal',
        category: categories.includes(event.category) ? event.category : 'unknown',
        boundary: boundaries.includes(event.boundary) ? event.boundary : 'query',
        status:
          typeof event.status === 'number' &&
          Number.isInteger(event.status) &&
          event.status >= 100 &&
          event.status <= 599
            ? event.status
            : null,
        latencyMs:
          event.latencyMs !== null && Number.isFinite(event.latencyMs) && event.latencyMs >= 0
            ? Math.round(event.latencyMs)
            : null,
        attempt:
          Number.isInteger(event.attempt) && event.attempt > 0 && event.attempt <= 2
            ? event.attempt
            : 1,
        ...(event.sqlState && sqlStates.has(event.sqlState) ? { sqlState: event.sqlState } : {}),
      })
    );
  } catch {
    // Diagnostics must never change authorization or query results.
  }
}
