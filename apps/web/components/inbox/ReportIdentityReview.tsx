import type { ReportIdentityReview as Review } from '@drasil/contracts';
import { Timestamp } from '@/components/workspace/Timestamp';
const reasons: Record<NonNullable<Review['reason']>, string> = {
  submission_recovery: 'The selected report needs submission reconciliation',
  no_match: 'No matching account was found',
  ambiguous: 'More than one account matched',
  conflicting_anchors: 'Account references conflicted',
  uncertain_text: 'Account details were unclear',
  incomplete_coverage: 'The member lookup was incomplete',
  evidence_unavailable: 'Evidence was unavailable',
  evidence_over_budget: 'Evidence exceeded processing limits',
  provider_failure: 'Evidence processing was unavailable',
  lookup_failure: 'The member lookup failed',
  rejected: 'The reporter rejected the suggested account',
  confirmation_timeout: 'The reporter did not answer the confirmation',
};
const coverage: Record<NonNullable<Review['coverageKind']>, string> = {
  complete: 'Complete member lookup',
  partial: 'Partial member lookup',
  unavailable: 'Coverage unavailable',
  not_required: 'Validated account reference, name lookup not required',
};
export function ReportIdentityReview({ review }: { review: Review | null | undefined }) {
  if (!review) return null;
  return (
    <section aria-label="Identity review">
      <h2>{review.phase === 'resolved' ? 'Review resolved' : 'Needs admin review'}</h2>
      <p>Evidence saved for moderator review.</p>
      <p>
        {review.phase === 'acknowledged'
          ? 'Acknowledged, review remains open'
          : review.phase === 'resolved'
            ? 'Review resolved'
            : 'Awaiting staff review'}
      </p>
      <p>
        {review.delivery === 'delivered'
          ? 'Moderator notification delivered'
          : review.delivery === 'pending'
            ? 'Moderator notification pending'
            : 'Notification delivery unknown'}
      </p>
      <p>
        {review.receipt === 'sent'
          ? 'Reporter receipt sent'
          : review.receipt === 'pending'
            ? 'Reporter receipt pending'
            : 'Reporter receipt unknown'}
      </p>
      {review.acknowledgedAt ? (
        <p>
          <Timestamp value={review.acknowledgedAt} prefix="Acknowledged" />
          {review.acknowledgedBy ? ` by ${review.acknowledgedBy}` : ''}
        </p>
      ) : null}
      {review.resolvedAt ? (
        <p>
          <Timestamp value={review.resolvedAt} prefix="Resolved" />
          {review.resolvedBy ? ` by ${review.resolvedBy}` : ''}
        </p>
      ) : null}
      <dl>
        <dt>Reason review began</dt>
        <dd>{review.reason ? reasons[review.reason] : 'Unknown'}</dd>
        <dt>Current lookup coverage</dt>
        <dd>{review.coverageKind ? coverage[review.coverageKind] : 'Not established'}</dd>
        <dt>Current candidates</dt>
        <dd>
          {review.candidateCount === null
            ? 'Not established'
            : `${review.candidateCount}${review.candidateCount > review.candidates.length ? `, showing ${review.candidates.length}` : ''}`}
        </dd>
        <dt>Evidence revision</dt>
        <dd>{review.evidenceRevision ?? 'Unknown'}</dd>
      </dl>
      <ul>
        {review.candidates.map((candidate) => (
          <li key={candidate.candidateId}>
            <dl>
              <dt>Server display name</dt>
              <dd>
                {candidate.nickname ?? candidate.globalName ?? candidate.username ?? 'Unknown'}
              </dd>
              <dt>Account display name</dt>
              <dd>{candidate.globalName ?? 'Not recorded'}</dd>
              <dt>Server nickname</dt>
              <dd>{candidate.nickname ?? 'Not recorded'}</dd>
              <dt>Username</dt>
              <dd>{candidate.username ?? 'Not recorded'}</dd>
              <dt>User ID</dt>
              <dd>{candidate.discordUserId}</dd>
              <dt>Matched fields</dt>
              <dd>{candidate.matchedFields.join(', ') || 'Not recorded'}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
