import { captchaCommandSchema, type CaptchaCommand } from '../containment/captcha';
import {
  queuedQuarantineCommandSchema,
  type QueuedQuarantineCommand,
} from '../containment/commands';
import { z } from 'zod';
import { queuedDetectionCommandSchema, type QueuedDetectionCommand } from '../detections/commands';
import { caseCommandSchema, type CaseCommand } from '../cases/commands';
type QueuedRepairCommand = Extract<CaseCommand, { kind: 'repair_active_case' }> & {
  readonly intent: 'moderator_repair';
};
type QueuedOpenCommand = Extract<CaseCommand, { kind: 'open_admin_case' }> & {
  readonly intent: 'dashboard_case_open';
};
type QueuedCaseCommand =
  | Exclude<
      CaseCommand,
      { kind: 'repair_active_case' | 'open_admin_case' | 'ban_user' | 'kick_user' }
    >
  | QueuedRepairCommand
  | QueuedOpenCommand;
const queuedCaseCommandSchema = caseCommandSchema.refine(
  (command): command is QueuedCaseCommand =>
    command.kind !== 'ban_user' &&
    command.kind !== 'kick_user' &&
    (command.kind !== 'repair_active_case' || command.intent === 'moderator_repair') &&
    (command.kind !== 'open_admin_case' || command.intent === 'dashboard_case_open'),
  'Ordinary staff moderation, native case openings and administrator slash repairs execute directly.'
);

export type QueuedCommand =
  | CaptchaCommand
  | QueuedCaseCommand
  | QueuedDetectionCommand
  | QueuedQuarantineCommand;
export const queuedCommandSchema = z.union([
  captchaCommandSchema,
  queuedCaseCommandSchema,
  queuedDetectionCommandSchema,
  queuedQuarantineCommandSchema,
]);

export function isQueuedCaptchaCommand(command: QueuedCommand): command is CaptchaCommand {
  switch (command.kind) {
    case 'request_captcha_challenge':
    case 'retry_captcha_challenge':
    case 'bypass_captcha_challenge':
    case 'apply_captcha_pass':
    case 'notify_captcha_attention':
      return true;
    default:
      return false;
  }
}
