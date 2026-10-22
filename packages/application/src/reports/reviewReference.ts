import type { DelegatedPrincipal } from '../delegation/types';
export interface PrivateReportBanReview {
  readonly operationId: string;
  readonly targetUserId: string;
  readonly attemptToken: string;
  readonly updatedAt: Date;
  readonly observedBanId?: string;
}
export interface PortableReportReview {
  readonly operationId: string;
  readonly targetUserId: string;
  readonly reviewReference: string;
  readonly expiresAt: Date;
}
export interface ReportReviewReferenceStore {
  save(executionId: string, reference: PrivateReportBanReview): Promise<PortableReportReview>;
  load(
    principal: DelegatedPrincipal,
    guildId: string,
    reference: string
  ): Promise<PortableReportReview | null>;
  claim(reviewExecutionId: string, reference: string): Promise<PrivateReportBanReview | null>;
}
