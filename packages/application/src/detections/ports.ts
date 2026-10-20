import type { AuthorityPort } from '../authorization';
import type { ConfirmationPort } from '../confirmation';
export type ObservedBanResult =
  | { readonly status: 'banned' }
  | { readonly status: 'already_handled' }
  | { readonly status: 'banned_updates_pending'; readonly operationId: string }
  | { readonly status: 'ban_outcome_unknown'; readonly operationId: string };
export interface DetectionPolicy {
  readonly banEnabled: boolean;
  readonly kickEnabled: boolean;
  readonly banRequiresReason: boolean;
  readonly kickRequiresReason: boolean;
}
export interface DetectionFacts {
  readonly guildId: string | null;
  readonly targetUserId: string;
  readonly reportId: string | null;
}
export interface DetectionOperation extends DetectionFacts {
  readonly guildId: string;
  readonly id: string;
  readonly detectionEventId: string;
  readonly actorId: string;
  readonly source: string;
  readonly continuation: 'fresh' | 'preparing' | 'confirmed' | 'uncertain' | 'completed';
  readonly owned: boolean;
}
export interface DetectionInput {
  readonly guildId: string;
  readonly actorId: string;
  readonly source: string;
  readonly operationId: string;
  readonly targetUserId: string;
  readonly detectionEventId: string;
}
export interface ReviewReference {
  readonly operationId: string;
  readonly targetUserId: string;
  readonly reviewReference: string;
}
export interface DetectionWorkflows {
  dismiss(input: DetectionInput, action: 'dismiss' | 'false_positive'): Promise<boolean>;
  undo(input: DetectionInput): Promise<'dismiss' | 'false_positive' | null>;
  changeAccounting(
    input: DetectionInput,
    excluded: boolean,
    reason: string | null
  ): Promise<boolean>;
  kick(input: DetectionInput, reason: string): Promise<boolean>;
  ban(
    input: DetectionInput,
    reason: string
  ): Promise<{ readonly result: ObservedBanResult; readonly banById: boolean }>;
  reconcile(input: DetectionInput): Promise<ObservedBanResult>;
  prepareReview(input: {
    readonly guildId: string;
    readonly actorId: string;
    readonly operationId: string;
  }): Promise<ReviewReference>;
  review(input: {
    readonly guildId: string;
    readonly actorId: string;
    readonly reference: ReviewReference;
    readonly reason: string;
  }): Promise<void>;
}
export interface DetectionDependencies {
  readonly authority: AuthorityPort;
  readonly globalAccountingAdmins: { containsFresh(userId: string): Promise<boolean> };
  readonly confirmations: ConfirmationPort;
  readonly settings: { loadFresh(guildId: string): Promise<DetectionPolicy> };
  readonly repository: {
    findDetection(id: string): Promise<DetectionFacts | null>;
    findOperation(id: string): Promise<DetectionOperation | null>;
  };
  readonly workflows: DetectionWorkflows;
}
