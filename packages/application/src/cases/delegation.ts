import { canonicalDigest } from '../delegation/intents';
import { ActionDeniedError } from '../results';
import type { CaseCommand } from './commands';
import type { CaseDependencies, CasePolicy } from './ports';
import { evaluateCasePolicy } from './policy';

export interface SelectedMessageState {
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly fingerprint: string;
}
export interface SelectedMessageContent extends Omit<SelectedMessageState, 'fingerprint'> {
  readonly content: string;
  readonly attachments: readonly {
    readonly id: string;
    readonly name: string | null;
    readonly url: string | null;
    readonly size: number | null;
  }[];
}
export function selectedMessageFingerprint(message: SelectedMessageContent): string {
  return canonicalDigest({
    ...message,
    attachments: [...message.attachments].sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export interface CasePreconditions {
  readonly kind: 'case_workflow';
  readonly stateDigest: string;
  readonly selectedMessage: SelectedMessageState | null;
}
export interface CaseResolutionDependencies extends Pick<CaseDependencies, 'settings'> {
  readonly repository: Pick<
    CaseDependencies['repository'],
    'findById' | 'findActive' | 'findDetection'
  >;
  /** Must authorize the real actor and bot against current channel/thread visibility. */
  selectedMessage(command: CaseCommand): Promise<SelectedMessageState | null>;
}
function relevantPolicy(command: CaseCommand, policy: CasePolicy): unknown {
  switch (command.kind) {
    case 'ban_user':
    case 'ban_case_user':
    case 'ban_case_user_by_id':
      return [policy.moderatorBanActionEnabled, policy.moderatorBanActionRequiresReason];
    case 'kick_user':
    case 'kick_case_user':
      return [policy.moderatorKickActionEnabled, policy.moderatorKickActionRequiresReason];
    case 'open_admin_case':
      return policy.adminCaseOpenRequiresReason;
    default:
      return null;
  }
}
/** Read-only resource/policy snapshot shared by intent acceptance and the actual worker. */
export async function resolveCasePreconditions(
  guildId: string,
  command: CaseCommand,
  deps: CaseResolutionDependencies
): Promise<CasePreconditions> {
  const policy = await deps.settings.loadFresh(guildId);
  const denial = evaluateCasePolicy(command, policy);
  if (denial) throw new ActionDeniedError(denial);
  const state = 'caseId' in command ? await deps.repository.findById(command.caseId) : null;
  if (
    'caseId' in command &&
    (!state || state.server_id !== guildId || state.user_id !== command.targetUserId)
  )
    throw new ActionDeniedError('binding_mismatch');
  const active =
    'caseId' in command ? await deps.repository.findActive(guildId, command.targetUserId) : null;
  const detection =
    'detectionEventId' in command && command.detectionEventId
      ? await deps.repository.findDetection(command.detectionEventId)
      : null;
  if (
    'detectionEventId' in command &&
    command.detectionEventId &&
    (!detection ||
      detection.server_id !== guildId ||
      detection.user_id !== command.targetUserId ||
      (command.kind === 'open_case_from_observed_detection' &&
        command.reportId !== null &&
        detection.reportId !== command.reportId))
  )
    throw new ActionDeniedError('binding_mismatch');
  let selectedMessage: SelectedMessageState | null = null;
  if ('selectedMessage' in command && command.selectedMessage) {
    selectedMessage = await deps.selectedMessage(command);
    if (
      !selectedMessage ||
      selectedMessage.guildId !== guildId ||
      selectedMessage.userId !== command.targetUserId ||
      selectedMessage.channelId !== command.selectedMessage.channelId ||
      selectedMessage.messageId !== command.selectedMessage.messageId
    )
      throw new ActionDeniedError('selected_message_unavailable');
  }
  return {
    kind: 'case_workflow',
    selectedMessage,
    stateDigest: canonicalDigest({
      policy: relevantPolicy(command, policy),
      state: state
        ? {
            id: state.id,
            status: state.status,
            caseKind: state.case_kind ?? null,
            attention: state.attention_state ?? null,
            revision: state.case_revision ?? null,
          }
        : null,
      active: active?.id ?? null,
      detection,
      selectedMessage,
    }),
  };
}
