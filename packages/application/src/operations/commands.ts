import type { QueuedCommand } from '../requests/commands';
import { z } from 'zod';
const id = z.string().min(1);
const days = z.number().int().min(1).max(365);
export const queuedOperationCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sync_moderation_queue') }).strict(),
  z.object({ kind: z.literal('clear_moderation_queue') }).strict(),
  z
    .object({
      kind: z.literal('close_resolved_case_threads'),
      intent: z.literal('administrator_operation'),
      execute: z.boolean(),
      days,
      limit: z.number().int().min(1).max(500),
      userId: id.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('audit_case_role_lockdown') }).strict(),
  z
    .object({ kind: z.literal('apply_case_role_lockdown'), unsyncAllowedChannels: z.boolean() })
    .strict(),
  z
    .object({
      kind: z.literal('intake_role_members'),
      roleId: id,
      execute: z.boolean(),
      limit: z.number().int().min(1).max(250),
      reason: z.string().nullable(),
    })
    .strict(),
]);
export const operationCommandSchema = z.union([
  queuedOperationCommandSchema,
  z
    .object({
      kind: z.literal('close_resolved_case_threads'),
      intent: z.literal('guild_audit'),
      execute: z.boolean(),
      days,
      limit: z.number().int().min(1).max(500),
      userId: id.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('audit_integrity'),
      scope: z.enum(['all', 'cases', 'case_role', 'queue']),
      days,
      limit: z.number().int().min(1).max(250),
      userId: id.nullable(),
    })
    .strict(),
]);
export type QueuedOperationCommand = z.infer<typeof queuedOperationCommandSchema>;
export type OperationCommand = z.infer<typeof operationCommandSchema>;
export function isQueuedOperationKind(kind: string): kind is QueuedOperationCommand['kind'] {
  return [
    'sync_moderation_queue',
    'clear_moderation_queue',
    'close_resolved_case_threads',
    'audit_case_role_lockdown',
    'apply_case_role_lockdown',
    'intake_role_members',
  ].includes(kind);
}

export function isQueuedOperationCommand(
  command: QueuedCommand | OperationCommand
): command is QueuedOperationCommand {
  return (
    isQueuedOperationKind(command.kind) &&
    (command.kind !== 'close_resolved_case_threads' || command.intent === 'administrator_operation')
  );
}
