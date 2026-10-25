'use client';

import { useEffect, useState } from 'react';
import type { CaseDetail, CaptchaChallengeSummary } from '@drasil/contracts';
import type {
  SecurityCheckConfiguration,
  WorkspaceActionPolicy,
} from '@/lib/moderationWorkspaceTypes';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { WorkspaceMutation } from '@/lib/workspaceActionTypes';
import {
  formatCaptchaHistoryEntry,
  formatCaptchaMethod,
  formatCaptchaStatus,
} from '@/lib/casePresentation';
import {
  ConfirmedAction,
  type ConfirmedActionDescriptor,
} from '@/components/workspace/actions/ConfirmedAction';
import { Timestamp } from '@/components/workspace/Timestamp';
import { recordLabel } from './caseRecordLabel';
import styles from './BrowserSecurityPanel.module.css';

export interface BrowserSecurityPanelProps {
  readonly detail: CaseDetail;
  readonly configuration: SecurityCheckConfiguration | null;
  readonly policy: WorkspaceActionPolicy;
  readonly submissions: {
    readonly issue: WorkspaceMutation;
    readonly retry: WorkspaceMutation;
    readonly bypass: WorkspaceMutation;
  };
  readonly requests: readonly ModerationActionRequestSummary[];
  readonly loadedAt: string;
  readonly returnHref: string;
}
type SecurityAction = 'challenge_user' | 'retry_captcha' | 'bypass_captcha';
type Binding = Pick<CaptchaChallengeSummary, 'id' | 'generation'>;
interface SecurityIntent {
  readonly challenge: Binding | null;
  readonly configuration: SecurityCheckConfiguration | null;
}
const actionTypes = {
  challenge_user: 'request_captcha_challenge',
  retry_captcha: 'retry_captcha_challenge',
  bypass_captcha: 'bypass_captcha_challenge',
} as const;

export function BrowserSecurityPanel({
  detail,
  configuration,
  policy,
  submissions,
  requests,
  loadedAt,
  returnHref,
}: BrowserSecurityPanelProps) {
  const challenge = detail.captchaChallenge;
  const allowed = (action: SecurityAction): boolean => {
    if (
      detail.caseKind === 'compromised_account' ||
      detail.status !== 'pending' ||
      !policy.canQueueCaseActions ||
      !policy.allowedActions.includes(action) ||
      !detail.allowedActions.includes(action)
    )
      return false;
    if (action !== 'bypass_captcha' && (!configuration || configuration.method === 'none'))
      return false;
    if (action === 'challenge_user') return !challenge && detail.presenceState === 'in_server';
    if (!challenge || challenge.status === 'passed') return false;
    if (action === 'bypass_captcha')
      return ['pending', 'failed', 'expired'].includes(challenge.status);
    return (
      detail.presenceState === 'in_server' &&
      (challenge.status !== 'pending' || Boolean(challenge.deliveryErrorCode))
    );
  };
  const available = (['challenge_user', 'retry_captcha', 'bypass_captcha'] as const).filter(
    allowed
  );
  // Keep an already-open confirmation mounted when refreshed eligibility changes.
  const [offered, setOffered] = useState<readonly SecurityAction[]>(available);
  useEffect(() => {
    setOffered((previous) =>
      available.every((action) => previous.includes(action))
        ? previous
        : [...new Set([...previous, ...available])]
    );
  }, [available.join(':')]);
  const [submitted, setSubmitted] = useState<Partial<Record<SecurityAction, SecurityIntent>>>({});
  const target = {
    kind: 'case',
    guildId: detail.guildId,
    recordId: detail.id,
    targetUserId: detail.userId,
    label: `${detail.userIdentity.displayLabel} · ${detail.userId} · ${detail.id}`,
    loadedAt,
    returnTo: returnHref,
  } as const;
  const scoped = requests.filter(
    (request) => request.verificationEventId === detail.id && request.targetUserId === detail.userId
  );
  const currentIntent: SecurityIntent = { challenge: challenge ?? null, configuration };
  const matchesIntent = (
    request: ModerationActionRequestSummary,
    id: SecurityAction,
    intent: SecurityIntent
  ): boolean => {
    if (request.actionType !== actionTypes[id]) return false;
    if (
      id !== 'challenge_user' &&
      (!intent.challenge ||
        request.captchaBinding?.challengeId !== intent.challenge.id ||
        request.captchaBinding.generation !== intent.challenge.generation)
    )
      return false;
    return (
      id === 'bypass_captcha' ||
      Boolean(
        intent.configuration &&
        request.captchaConfiguration?.method === intent.configuration.method &&
        request.captchaConfiguration.methodRevision === intent.configuration.methodRevision
      )
    );
  };
  const intentKey = (id: SecurityAction, intent: SecurityIntent): string =>
    `${intent.challenge?.id ?? 'unissued'}:${intent.challenge?.generation ?? 'none'}:${id === 'bypass_captcha' ? '' : `${intent.configuration?.method ?? 'unknown'}:${intent.configuration?.methodRevision ?? 'unknown'}`}`;
  const [attemptKeys, setAttemptKeys] = useState<Partial<Record<SecurityAction, string>>>({});
  useEffect(() => {
    for (const id of ['retry_captcha', 'bypass_captcha'] as const) {
      const previous = submitted[id];
      if (
        !previous ||
        !challenge ||
        !scoped.some(
          (request) =>
            matchesIntent(request, id, previous) &&
            (request.status === 'completed' || request.status === 'failed')
        )
      )
        continue;
      if (intentKey(id, previous) === intentKey(id, currentIntent)) continue;
      const key = intentKey(id, currentIntent);
      setAttemptKeys((values) => (values[id] === key ? values : { ...values, [id]: key }));
      // A terminal submitted intent can renew the action only once.
      setSubmitted((values) => {
        if (values[id] !== previous) return values;
        const remaining = { ...values };
        delete remaining[id];
        return remaining;
      });
    }
  }, [submitted, challenge, configuration, requests]);
  const running = scoped.some(
    (request) =>
      Object.values(actionTypes).some((type) => type === request.actionType) &&
      (request.status === 'queued' || request.status === 'processing')
  );
  const fields = challenge
    ? [
        { name: 'expectedCaptchaChallengeId', value: challenge.id },
        { name: 'expectedCaptchaGeneration', value: String(challenge.generation) },
        { name: 'expectedCaptchaMethod', value: challenge.method },
        { name: 'expectedCaptchaMethodRevision', value: String(challenge.methodRevision) },
      ]
    : [];
  const issuanceFields = configuration
    ? [
        { name: 'expectedCaptchaConfigurationMethod', value: configuration.method },
        {
          name: 'expectedCaptchaConfigurationRevision',
          value: String(configuration.methodRevision),
        },
      ]
    : [];
  const issuanceDescription =
    configuration && configuration.method !== 'none'
      ? `${formatCaptchaMethod(configuration.method)}, method revision ${configuration.methodRevision}`
      : 'Configuration unavailable';
  const descriptors: Record<SecurityAction, ConfirmedActionDescriptor> = {
    challenge_user: {
      id: 'challenge_user',
      label: 'Request security check',
      description: `Request ${issuanceDescription} for this member. A moderator-requested pass records evidence and leaves the case open.`,
      fields: issuanceFields,
    },
    retry_captcha: {
      id: 'retry_captcha',
      label: 'Retry security check',
      description: `${challenge ? `${formatCaptchaMethod(challenge.method)}, method revision ${challenge.methodRevision}, generation ${challenge.generation}. ` : ''}Invalidate this generation and request ${issuanceDescription}.`,
      fields: [...fields, ...issuanceFields],
    },
    bypass_captcha: {
      id: 'bypass_captcha',
      label: 'Continue without security check',
      tone: 'warning',
      description: `${challenge ? `${formatCaptchaMethod(challenge.method)}, method revision ${challenge.methodRevision}, generation ${challenge.generation}. ` : ''}Record a reason and continue moderator review without treating the security check as passed. The case stays open.`,
      reasonRequired: true,
      fields,
    },
  };
  const bindings: Record<SecurityAction, WorkspaceMutation> = {
    challenge_user: submissions.issue,
    retry_captcha: submissions.retry,
    bypass_captcha: submissions.bypass,
  };
  return (
    <section className={styles.panel} aria-label="Security check">
      <h2>Security check</h2>
      <p>
        {detail.status === 'pending'
          ? 'Case open'
          : `Case ${recordLabel(detail.status).toLowerCase()}`}
      </p>
      {challenge ? (
        <>
          <p
            className={styles.state}
            data-severity={
              challenge.status === 'failed' ||
              challenge.status === 'expired' ||
              challenge.deliveryErrorCode
                ? 'warning'
                : challenge.status === 'passed'
                  ? 'positive'
                  : 'neutral'
            }
          >
            {formatCaptchaStatus(challenge.status)}
          </p>
          <p>
            {formatCaptchaMethod(challenge.method)} · Method revision {challenge.methodRevision} ·
            Generation {challenge.generation}
          </p>
          <p>
            {challenge.requestSource === 'automatic_suspicious_join'
              ? 'Automatic suspicious-join check'
              : 'Moderator-requested check'}{' '}
            ·{' '}
            {challenge.passEffect === 'evidence_only'
              ? 'Evidence only. A pass leaves the case open for moderator review.'
              : 'A pass requests automatic verification for the join-only case. Case status above reflects the recorded outcome.'}
          </p>
          {challenge.deliveryErrorCode ? (
            <p className={styles.warning}>Delivery failed · {challenge.deliveryErrorCode}</p>
          ) : challenge.deliveredAt ? (
            <p>
              {challenge.method === 'discord_image'
                ? 'Image challenge delivered in Discord'
                : 'Browser-check link delivered in Discord'}
            </p>
          ) : (
            <p>Delivery not recorded</p>
          )}
          <dl className={styles.facts}>
            <dt>Requested</dt>
            <dd>
              <Timestamp value={challenge.requestedAt} />
            </dd>
            <dt>Delivered</dt>
            <dd>
              <Timestamp value={challenge.deliveredAt} />
            </dd>
            <dt>{challenge.status === 'expired' ? 'Expired' : 'Expires'}</dt>
            <dd>
              <Timestamp value={challenge.expiresAt} />
            </dd>
            <dt>Submissions</dt>
            <dd>{challenge.submissionCount}</dd>
            {challenge.passedAt ? (
              <>
                <dt>Passed</dt>
                <dd>
                  <Timestamp value={challenge.passedAt} />
                </dd>
              </>
            ) : null}
            {challenge.bypassedAt ? (
              <>
                <dt>Bypassed</dt>
                <dd>
                  <Timestamp value={challenge.bypassedAt} />
                </dd>
              </>
            ) : null}
            {challenge.bypassedBy ? (
              <>
                <dt>Bypassed by</dt>
                <dd>{challenge.bypassedBy}</dd>
              </>
            ) : null}
          </dl>
          {challenge.bypassReason ? (
            <p className={styles.reason}>Bypass reason: {challenge.bypassReason}</p>
          ) : null}
          {challenge.history?.length ? (
            <details>
              <summary>Generation history · {challenge.history.length}</summary>
              <ol>
                {challenge.history.map((entry) => (
                  <li key={entry.generation}>
                    {formatCaptchaHistoryEntry(
                      entry,
                      entry.generation === challenge.generation ? challenge.status : undefined
                    )}
                    {entry.outcomeAt ? (
                      <>
                        {' '}
                        Outcome recorded <Timestamp value={entry.outcomeAt} />.
                      </>
                    ) : null}
                    {entry.bypassedBy ? <> Bypassed by {entry.bypassedBy}.</> : null}
                    {entry.bypassedAt ? (
                      <>
                        {' '}
                        Bypassed <Timestamp value={entry.bypassedAt} />.
                      </>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : (
        <p>Not issued</p>
      )}
      {!configuration ? (
        <p>Security-check configuration unavailable.</p>
      ) : configuration.method === 'none' ? (
        <p>Security-check issuance disabled.</p>
      ) : (
        <p>
          Configured for new checks: {formatCaptchaMethod(configuration.method)} · Method revision{' '}
          {configuration.methodRevision}
        </p>
      )}
      <div className={styles.actions}>
        {[...new Set([...offered, ...available])].map((id) => {
          const intent = submitted[id] ?? currentIntent;
          const request = scoped.find((request) => matchesIntent(request, id, intent)) ?? null;
          return (
            <ConfirmedAction
              key={`${id}:${attemptKeys[id] ?? 'initial'}`}
              target={target}
              hideTrigger={!allowed(id)}
              action={{ ...descriptors[id], disabled: !allowed(id) || running }}
              submit={async (form) => {
                const generation = Number(form.get('expectedCaptchaGeneration'));
                const challengeId = form.get('expectedCaptchaChallengeId');
                const method = form.get('expectedCaptchaConfigurationMethod');
                const revision = Number(form.get('expectedCaptchaConfigurationRevision'));
                setSubmitted((previous) => ({
                  ...previous,
                  [id]: {
                    challenge:
                      typeof challengeId === 'string' &&
                      Number.isInteger(generation) &&
                      generation > 0
                        ? { id: challengeId, generation }
                        : null,
                    configuration:
                      (method === 'turnstile' || method === 'discord_image') &&
                      Number.isInteger(revision) &&
                      revision >= 0
                        ? { method, methodRevision: revision }
                        : null,
                  },
                }));
                return bindings[id](form);
              }}
              durableRequest={request}
              record={detail}
            />
          );
        })}
      </div>
    </section>
  );
}
