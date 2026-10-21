import type { CaseCommand } from './commands';
/** Explicit public fields, never the saved resource snapshot or private message fingerprint. */
export function caseActionSummary(command: CaseCommand): string {
  const values: Record<string, unknown> = { targetUserId: command.targetUserId };
  if ('caseId' in command) values.caseId = command.caseId;
  if ('reason' in command) values.reason = command.reason;
  if ('intent' in command) values.intent = command.intent;
  if ('mode' in command) values.mode = command.mode;
  if ('detectionEventId' in command) values.detectionEventId = command.detectionEventId;
  if ('reportId' in command) values.reportId = command.reportId;
  if ('selectedMessage' in command) values.selectedMessage = command.selectedMessage;
  if ('origin' in command && command.origin) values.observedAlert = command.origin;
  const native = command.kind === 'ban_user' || command.kind === 'kick_user';
  return `${command.kind.replace(/_/g, ' ')}: ${JSON.stringify(values)}.${native ? ' If a previous attempt is uncertain, its historical outcome remains unknown. A fresh intent and key starts a separate attempt that may repeat an effect.' : ''}`;
}
