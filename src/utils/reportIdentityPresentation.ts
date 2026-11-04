import type { ReportIdentityCandidate } from '@drasil/application';
import { formatInlineIdentifier } from './discordUserIdentity';

type Candidate = Pick<
  ReportIdentityCandidate,
  'discordUserId' | 'username' | 'globalName' | 'displayName' | 'nickname'
> &
  Partial<Pick<ReportIdentityCandidate, 'matchedFields'>>;
const labels: Record<ReportIdentityCandidate['matchedFields'][number], string> = {
  username: 'username',
  globalName: 'account display name',
  nickname: 'server nickname',
  displayName: 'server display name',
  userId: 'user ID',
  messageAuthor: 'message author',
};
export function formatReportIdentity(candidate: Candidate): string {
  const effective =
    candidate.displayName ??
    candidate.nickname ??
    candidate.globalName ??
    candidate.username ??
    'unknown user';
  const username = candidate.username?.trim();
  const seen = new Set([effective, username]);
  const details = [
    username && username !== effective
      ? `${formatInlineIdentifier(effective)} (@${formatInlineIdentifier(username)})`
      : username
        ? `@${formatInlineIdentifier(username)}`
        : formatInlineIdentifier(effective),
  ];
  for (const [label, value] of [
    ['Account display name', candidate.globalName],
    ['Server nickname', candidate.nickname],
  ]) {
    if (value && !seen.has(value)) {
      details.push(`${label}: ${formatInlineIdentifier(value)}`);
      seen.add(value);
    }
  }
  details.push(`User ID: ${formatInlineIdentifier(candidate.discordUserId)}`);
  if (candidate.matchedFields?.length)
    details.push(
      `Matched: ${[...new Set(candidate.matchedFields.map((field) => labels[field]))].join(', ')}`
    );
  return details.join('\n');
}
