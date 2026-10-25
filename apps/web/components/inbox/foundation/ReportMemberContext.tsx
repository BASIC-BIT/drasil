import type { MemberProfile, ReportDetail } from '@drasil/contracts';
import { Timestamp } from './Timestamp';
import styles from './ReportInbox.module.css';

const presenceLabels: Record<MemberProfile['presenceState'], string> = {
  in_server: 'In server',
  left_or_removed: 'Left or removed',
  banned: 'Banned',
  kicked: 'Kicked',
  unknown: 'Unknown',
};

interface ReportMemberContextProps {
  readonly report: ReportDetail;
  readonly profile?: MemberProfile;
}

export function ReportMemberContext({ report, profile }: ReportMemberContextProps) {
  const priorReviews =
    profile?.detections.flatMap((detection) =>
      detection.observedAction &&
      detection.observedActionAt &&
      Date.parse(detection.observedActionAt) < Date.parse(report.createdAt)
        ? [{ action: detection.observedAction, at: detection.observedActionAt }]
        : []
    ) ?? [];
  const priorReview = priorReviews.sort(
    (left, right) => Date.parse(right.at) - Date.parse(left.at)
  )[0];
  return (
    <section className={styles.memberContext} aria-label="Member context">
      <div className={styles.contextIdentity}>
        <span>
          Member ID <strong>{report.targetUserId ?? 'Not confirmed'}</strong>
        </span>
        {report.targetUserId ? (
          <a href={`/admin/guild/${report.guildId}/members/${report.targetUserId}`}>
            Member history
          </a>
        ) : null}
        {report.latestCaseId ? (
          <a href={`/admin/guild/${report.guildId}/cases/${report.latestCaseId}`}>Linked case</a>
        ) : null}
      </div>
      {profile ? (
        <dl className={styles.contextFacts}>
          {profile.presenceState !== 'unknown' ? (
            <div>
              <dt className={styles.srOnly}>Presence</dt>
              <dd>{presenceLabels[profile.presenceState]}</dd>
            </div>
          ) : null}
          {profile.membership.caseRoleActive !== null ? (
            <div>
              <dt>Case role</dt>
              <dd>{profile.membership.caseRoleActive ? 'Active' : 'Inactive'}</dd>
            </div>
          ) : null}
          {profile.membership.joinDate ? (
            <div>
              <dt>Joined</dt>
              <dd>
                <Timestamp value={profile.membership.joinDate} format="date" />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {priorReview ? (
        <p className={styles.priorReview}>
          <span>Prior review</span>
          <strong>
            {priorReview.action === 'false_positive' ? 'Marked false positive' : 'Dismissed'}
          </strong>
          <Timestamp value={priorReview.at} />
        </p>
      ) : null}
    </section>
  );
}
