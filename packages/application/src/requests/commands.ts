import { caseCommandSchema, type CaseCommand } from '../cases/commands';
type QueuedRepairCommand = Extract<CaseCommand, { kind: 'repair_active_case' }> & {
  readonly intent: 'moderator_repair';
};
export type QueuedCommand =
  | Exclude<CaseCommand, { kind: 'repair_active_case' }>
  | QueuedRepairCommand;
export const queuedCommandSchema = caseCommandSchema.refine(
  (command): command is QueuedCommand =>
    command.kind !== 'repair_active_case' || command.intent === 'moderator_repair',
  'Administrator slash repairs execute directly.'
);
