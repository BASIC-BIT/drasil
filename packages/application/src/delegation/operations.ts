import { createHash } from 'node:crypto';
import type { DelegatedPrincipal, ConfirmationMethod } from './types';
import type { WorkflowId } from './commands';
export type LimitDecision = { kind: 'allowed' } | { kind: 'limited'; retryAfterSeconds: number };
export type LimitCategory = 'read' | 'submission' | 'new_intent' | 'registration';
export type LimitSubject =
  | (DelegatedPrincipal & { guildId?: string })
  | { registrationIpHash: string };
export interface McpOperationalPort {
  checkMcpLimit(subject: LimitSubject, category: LimitCategory): Promise<LimitDecision>;
  recordMcpAudit(event: McpAuditEvent): Promise<void>;
  enabled(): boolean;
}
export interface McpAuditEvent {
  event: 'admission' | 'intent' | 'execution' | 'observation' | 'maintenance';
  userId?: string;
  guildId?: string;
  clientId?: string;
  connectionId?: string;
  grantVersion?: number;
  workflowId?: WorkflowId;
  confirmationMethod?: ConfirmationMethod;
  executionId?: string;
  requestId?: string;
  outcome?:
    | 'confirmation_required'
    | 'queued'
    | 'running'
    | 'completed'
    | 'denied'
    | 'failed'
    | 'partial'
    | 'uncertain'
    | 'expired'
    | 'cancelled'
    | 'limited';
  queueDelayMs?: number;
}
export type McpAuditPort = (event: McpAuditEvent) => Promise<void>;
/** The serializer is the logging boundary; no input object/Error is ever forwarded to a sink. */
export function createMcpAudit(sink: (line: string) => void): McpAuditPort {
  return async (event) => {
    const safe: Record<string, string | number> = {
      event: ['admission', 'intent', 'execution', 'observation', 'maintenance'].includes(
        event.event
      )
        ? event.event
        : 'admission',
    };
    for (const key of [
      'userId',
      'guildId',
      'clientId',
      'connectionId',
      'workflowId',
      'confirmationMethod',
      'executionId',
      'requestId',
      'outcome',
    ] as const) {
      const value = event[key];
      if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)) safe[key] = value;
    }
    if (event.clientId && !safe.clientId)
      safe.clientIdHash = createHash('sha256').update(event.clientId).digest('hex');
    for (const key of ['grantVersion', 'queueDelayMs'] as const) {
      const value = event[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
    }
    try {
      sink(JSON.stringify(safe));
    } catch {
      /* Telemetry never changes a durable moderation result. */
    }
  };
}
export function isMcpEnabled(): boolean {
  return process.env.DRASIL_MCP_ENABLED === 'true';
}
