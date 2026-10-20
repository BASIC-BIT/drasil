import { caseCommandSchema, type CaseCommand } from '../cases/commands';
type QueuedRepairCommand = Extract<CaseCommand, { kind: 'repair_active_case' }> & {
  readonly intent: 'moderator_repair';
};
type QueuedOpenCommand = Extract<CaseCommand, { kind: 'open_admin_case' }> & {
  readonly intent: 'dashboard_case_open';
};
export type QueuedCommand =
  | Exclude<CaseCommand, { kind: 'repair_active_case' | 'open_admin_case' }>
  | QueuedRepairCommand
  | QueuedOpenCommand;
export const queuedCommandSchema = caseCommandSchema.refine(
  (command): command is QueuedCommand =>
    (command.kind !== 'repair_active_case' || command.intent === 'moderator_repair') &&
    (command.kind !== 'open_admin_case' || command.intent === 'dashboard_case_open'),
  'Native case openings and administrator slash repairs execute directly.'
);
