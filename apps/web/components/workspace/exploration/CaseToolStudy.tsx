'use client';

import { useState, type ReactNode } from 'react';
import type { CaptchaChallengeSummary, MessageCleanupScope } from '@drasil/contracts';
import { ActionButton } from '@/components/workspace/Foundation';
import { Timestamp } from '@/components/workspace/Timestamp';
import { fixtureMessageCleanupJobDetails } from '@/lib/messageCleanupFixtures';
import type { AccountQuarantinePreviewSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { StudyAction, ToolView } from './workflowStudyState';
import styles from './CaseToolStudy.module.css';

interface ToolProps {
  readonly onAction: (action: StudyAction) => void;
}

const quarantinePreview: AccountQuarantinePreviewSummary = {
  enabled: true,
  canContain: true,
  previewedAt: '2026-10-23T15:14:00.000Z',
  plannedRoles: [
    { roleId: 'role-member', roleName: 'Member', reason: null },
    { roleId: 'role-events', roleName: 'Event access', reason: null },
    { roleId: 'role-helper', roleName: 'Community helper', reason: 'Manage Messages' },
  ],
  privilegedRoles: [
    { roleId: 'role-helper', roleName: 'Community helper', reason: 'Manage Messages' },
  ],
  retainedRoles: [],
  caseRole: { roleId: 'role-case', roleName: 'Under review', reason: null },
  caseRoleReady: true,
  recoveryThreadId: 'recovery-thread-1842',
  recoveryThreadReady: true,
  adminNotificationReady: true,
  lockdownErrorCount: 0,
  lockdownIssueCount: 0,
  lockdownPlannedActionCount: 0,
  memberBypassCount: 0,
  unremovablePrivilegeReasons: [],
};

const check: CaptchaChallengeSummary = {
  id: '023b25e1-5537-450f-a486-90721442251e',
  status: 'pending',
  method: 'turnstile',
  methodRevision: 0,
  requestSource: 'moderator',
  passEffect: 'evidence_only',
  generation: 2,
  submissionCount: 1,
  requestedAt: '2026-10-23T14:20:00.000Z',
  deliveredAt: '2026-10-23T14:20:02.000Z',
  expiresAt: '2026-10-24T14:20:00.000Z',
  deliveryErrorCode: null,
  passedAt: null,
  bypassedAt: null,
  bypassedBy: null,
  bypassReason: null,
  history: [
    {
      generation: 1,
      method: 'turnstile',
      methodRevision: 0,
      requestSource: 'moderator',
      passEffect: 'evidence_only',
      caseRevisionAtIssue: 3,
      requestedBy: 'moderator-1',
      requestedAt: '2026-10-22T14:00:00.000Z',
      presentedAt: '2026-10-22T14:00:02.000Z',
      outcome: 'expired',
      outcomeAt: '2026-10-23T14:00:00.000Z',
      deliveryErrorCode: null,
      bypassedBy: null,
      bypassedAt: null,
      bypassReason: null,
    },
  ],
};

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ToolAction({ action, onAction }: ToolProps & { readonly action: StudyAction }) {
  return (
    <ActionButton tone={action.tone} onClick={() => onAction(action)}>
      {action.label}
    </ActionButton>
  );
}

function QuarantineStudy({
  state,
  onAction,
}: ToolProps & {
  readonly state: Extract<ToolView, { kind: 'quarantine' }>['state'];
}) {
  const incomplete = state === 'incomplete';
  const parked = state === 'parked';
  return (
    <section className={styles.document} aria-label="Account quarantine">
      <header className={styles.heading}>
        <span className={styles.eyebrow}>Account containment</span>
        <h2>
          {parked
            ? 'Recovery review'
            : incomplete
              ? 'Containment incomplete'
              : 'Quarantine account'}
        </h2>
        <p>
          {parked
            ? 'The case remains open while the member reports recovery.'
            : 'Remove server access while keeping the recovery thread open.'}
        </p>
      </header>
      <div className={styles.notice} data-tone={incomplete ? 'danger' : 'positive'}>
        <strong>
          {parked
            ? 'Contained · Parked'
            : incomplete
              ? 'Needs review · Not parked'
              : 'Ready for containment'}
        </strong>
        <p>
          {parked
            ? 'A reply requests moderator review. Release still requires verification.'
            : incomplete
              ? 'Two roles were removed. A retained role and channel permission still allow access.'
              : 'Three roles can be removed, including one privileged role. No permission bypasses found.'}
        </p>
      </div>
      <dl className={styles.facts}>
        <Fact label={parked ? 'Parked' : incomplete ? 'Attempted' : 'Live preview'}>
          <Timestamp
            value={
              state === 'preview'
                ? (quarantinePreview.previewedAt ?? '2026-10-23T15:14:00.000Z')
                : '2026-10-23T14:32:00.000Z'
            }
          />
          {state !== 'preview' ? ' by moderator-1' : null}
        </Fact>
        <Fact label="Case role">Under review · retained</Fact>
        <Fact label="Recovery thread">#account-recovery-1842 · open</Fact>
        <Fact label="Admin notification">Available</Fact>
      </dl>
      {parked ? (
        <section className={styles.section}>
          <h3>Recovery report</h3>
          <p className={styles.metadata}>
            Member reply · <Timestamp value="2026-10-23T15:05:00.000Z" />
          </p>
          <blockquote>
            I changed my password, signed out of other sessions and enabled two-factor
            authentication. Can you review my access?
          </blockquote>
          <p className={styles.muted}>Recovery review requested · quarantine remains active.</p>
        </section>
      ) : (
        <section className={styles.section}>
          <h3>{incomplete ? 'Recorded role effects' : 'Roles to remove'}</h3>
          <ul className={styles.rows}>
            {quarantinePreview.plannedRoles.map((role) => (
              <li key={role.roleId}>
                <span>
                  {role.roleName}
                  <small>{role.reason ?? 'Server access'}</small>
                </span>
                <span className={incomplete && role.reason ? styles.danger : styles.muted}>
                  {incomplete ? (role.reason ? 'Retained · above bot' : 'Removed') : 'Remove'}
                </span>
              </li>
            ))}
          </ul>
          {incomplete ? (
            <div className={styles.blocker}>
              <strong>Resolve two blockers</strong>
              <p>
                Community helper is above Drasil's highest role. A member-specific allow in #general
                bypasses the case-role lockdown.
              </p>
              <p>
                Repair the role hierarchy and channel overwrite in Discord, then run another
                preview. Removed roles stay removed.
              </p>
            </div>
          ) : (
            <p className={styles.muted}>
              Case-role lockdown is complete. The member stays in the server and no Discord timeout
              is applied.
            </p>
          )}
        </section>
      )}
      <section className={styles.section}>
        <h3>{parked ? 'Release and resolve' : 'Confirm containment'}</h3>
        <p>
          {parked
            ? 'Verification removes the case role, restores eligible saved roles and resolves the case and its threads. Roles that are no longer safe to restore are skipped and reported.'
            : 'Quarantine parks the case only after containment succeeds. Partial removals remain in place if containment is incomplete.'}
        </p>
        <div className={styles.actions}>
          {parked ? (
            <ToolAction
              onAction={onAction}
              action={{
                id: 'quarantine-release',
                label: 'Verify and release',
                tone: 'positive',
                effect:
                  'End this account quarantine, remove the case role, restore eligible saved roles and resolve the open verification case and its threads.',
              }}
            />
          ) : (
            <ToolAction
              onAction={onAction}
              action={
                incomplete
                  ? {
                      id: 'quarantine-refresh',
                      label: 'Preview containment again',
                      effect:
                        'Read current roles, recovery-thread readiness and permission blockers for a new quarantine preview.',
                    }
                  : {
                      id: 'quarantine-execute',
                      label: 'Quarantine account',
                      tone: 'warning',
                      reason: 'required',
                      effect:
                        'Remove Member, Event access and Community helper, including Manage Messages. Retain the case role and recovery thread. Park the open case only if containment succeeds.',
                    }
              }
            />
          )}
          {state === 'preview' ? (
            <ToolAction
              onAction={onAction}
              action={{
                id: 'quarantine-preview-refresh',
                label: 'Refresh preview',
                effect:
                  'Read current role and permission state. Replace the displayed quarantine preview.',
              }}
            />
          ) : null}
        </div>
        {state === 'preview' ? (
          <p className={styles.footnote}>
            Preview expires after 10 minutes. Role, permission or thread changes require a new
            preview.
          </p>
        ) : null}
      </section>
    </section>
  );
}

const checkStateCopy = {
  pending: {
    title: 'Browser check pending',
    status: 'Waiting for member',
    text: 'The link is available in the case thread. The restriction remains in place.',
  },
  passed: {
    title: 'Security check completed',
    status: 'Passed · Evidence only',
    text: 'The member completed the check. The case is open for moderator review.',
  },
  expired: {
    title: 'Browser check expired',
    status: 'Expired · Review required',
    text: 'The link expired before completion. The restriction remains in place.',
  },
  delivery_failed: {
    title: 'Browser check not delivered',
    status: 'Delivery failed',
    text: 'Drasil could not post the link to the case thread. Check thread access before retrying.',
  },
  bypassed: {
    title: 'Browser check bypassed',
    status: 'Bypassed · No pass recorded',
    text: 'A moderator continued review without the browser check. The case and restriction remain open.',
  },
};

function SecurityStudy({
  state,
  onAction,
}: ToolProps & {
  readonly state: Extract<ToolView, { kind: 'security' }>['state'];
}) {
  const copy = checkStateCopy[state];
  return (
    <section className={styles.document} aria-label="Browser security check">
      <header className={styles.heading}>
        <span className={styles.eyebrow}>Case security check</span>
        <h2>{copy.title}</h2>
      </header>
      <div className={styles.notice} data-tone={state === 'passed' ? 'positive' : 'warning'}>
        <strong>{copy.status}</strong>
        <p>{copy.text}</p>
      </div>
      <dl className={styles.facts}>
        <Fact label="Requested by">
          moderator-1 ·{' '}
          <Timestamp value={state === 'expired' ? '2026-10-22T14:20:00.000Z' : check.requestedAt} />
        </Fact>
        <Fact label="Generation">
          {check.generation} · {state === 'delivery_failed' ? '0' : check.submissionCount}{' '}
          submissions recorded
        </Fact>
        <Fact label="Delivery">
          {state === 'delivery_failed' ? (
            'Not delivered'
          ) : (
            <>
              <span>#account-review-1842 · </span>
              <Timestamp
                value={
                  state === 'expired'
                    ? '2026-10-22T14:20:02.000Z'
                    : (check.deliveredAt ?? check.requestedAt)
                }
              />
            </>
          )}
        </Fact>
        <Fact
          label={state === 'expired' ? 'Expired' : state === 'passed' ? 'Passed' : 'Link expires'}
        >
          <Timestamp
            value={
              state === 'passed'
                ? '2026-10-23T14:25:00.000Z'
                : state === 'expired'
                  ? '2026-10-23T14:20:00.000Z'
                  : check.expiresAt
            }
          />
        </Fact>
        <Fact label="Pass effect">Evidence only · moderator decision required</Fact>
        {state === 'bypassed' ? (
          <Fact label="Bypass">
            moderator-1 · <Timestamp value="2026-10-23T14:28:00.000Z" />
          </Fact>
        ) : null}
      </dl>
      <section className={styles.section}>
        <h3>{state === 'bypassed' ? 'Recorded reason' : 'Member instructions'}</h3>
        <blockquote>
          {state === 'bypassed'
            ? 'Browser check could not load. Continue review using the linked report and message evidence.'
            : 'Complete this browser check to confirm access to your Discord account.'}
        </blockquote>
      </section>
      <details className={styles.disclosure}>
        <summary>Earlier generation</summary>
        <dl className={styles.facts}>
          <Fact label="Generation 1">
            Expired · <Timestamp value="2026-10-23T14:00:00.000Z" />
          </Fact>
          <Fact label="Requested by">
            moderator-1 · <Timestamp value="2026-10-22T14:00:00.000Z" />
          </Fact>
        </dl>
      </details>
      {state !== 'passed' ? (
        <div className={styles.actions}>
          {state !== 'pending' ? (
            <ToolAction
              onAction={onAction}
              action={{
                id: `security-retry-${state}`,
                label: 'Retry security check',
                effect:
                  'Invalidate every earlier link and send generation 3 to the existing case thread. Reset the submission allowance. A pass will remain evidence only.',
              }}
            />
          ) : null}
          {state !== 'bypassed' ? (
            <ToolAction
              onAction={onAction}
              action={{
                id: `security-bypass-${state}`,
                label: 'Continue without browser check',
                tone: 'warning',
                reason: 'required',
                effect:
                  'Record a moderator bypass for generation 2. Leave the case and restriction open, with no browser pass recorded.',
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const cleanupScopes: readonly { readonly value: MessageCleanupScope; readonly label: string }[] = [
  { value: 'source_message', label: 'Source message' },
  { value: 'last_hour', label: 'Last hour' },
  { value: 'last_day', label: 'Last 24 hours' },
  { value: 'last_7_days', label: 'Last 7 days' },
];

function CleanupStudy({
  state,
  onAction,
}: ToolProps & {
  readonly state: Extract<ToolView, { kind: 'cleanup' }>['state'];
}) {
  const [scope, setScope] = useState<MessageCleanupScope>('source_message');
  const [combined, setCombined] = useState(false);
  const finished = state === 'results' || state === 'finalization';
  const job = fixtureMessageCleanupJobDetails.find(
    (item) => item.mode === (finished ? 'ban_with_cleanup' : 'delete_only')
  );
  if (!job) return null;
  const selectedScope =
    cleanupScopes.find((option) => option.value === scope)?.label ?? 'Source message';
  return (
    <section className={styles.document} aria-label="Message cleanup">
      <header className={styles.heading}>
        <span className={styles.eyebrow}>Case-linked messages</span>
        <h2>
          {state === 'scope'
            ? 'Message cleanup'
            : state === 'blocked'
              ? 'Preview incomplete'
              : state === 'results'
                ? 'Cleanup results'
                : state === 'finalization'
                  ? 'Case updates incomplete'
                  : 'Review frozen preview'}
        </h2>
        <p>
          {finished
            ? 'Ban, deletion and case updates have separate recorded outcomes.'
            : 'Review the exact messages before deleting them. Evidence is preserved first.'}
        </p>
      </header>
      {state === 'scope' ? (
        <>
          <section className={styles.section}>
            <h3>Choose a scope</h3>
            <div className={styles.scopeChoices} role="group" aria-label="Cleanup scope">
              {cleanupScopes.map((option) => (
                <ActionButton
                  aria-pressed={scope === option.value}
                  key={option.value}
                  onClick={() => setScope(option.value)}
                >
                  {option.label}
                </ActionButton>
              ))}
            </div>
            <p className={styles.muted}>
              Search the case member's messages. Up to 500 candidates can be previewed; execution is
              limited to 100.
            </p>
          </section>
          <section className={styles.section}>
            <h3>Action</h3>
            <label className={styles.checkbox}>
              <input
                checked={combined}
                onChange={(event) => setCombined(event.target.checked)}
                type="checkbox"
              />
              <span>Also ban the member</span>
            </label>
            <p className={styles.muted}>
              {combined
                ? 'Ban first, delete the frozen messages, then resolve the case. Cleanup failures do not reverse the ban.'
                : 'Delete reviewed messages and leave the moderation decision open.'}
            </p>
            <div className={styles.actions}>
              <ToolAction
                onAction={onAction}
                action={{
                  id: `cleanup-preview-${combined ? 'combined' : 'delete'}-${scope}`,
                  label: 'Preview messages',
                  reason: 'required',
                  effect: `Create a frozen ${selectedScope.toLowerCase()} preview for ${combined ? 'ban and message cleanup' : 'message deletion only'}. Record the reason; no messages are deleted by this step.`,
                }}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <div
            className={styles.notice}
            data-tone={state === 'blocked' || state === 'finalization' ? 'warning' : 'positive'}
          >
            <strong>
              {state === 'blocked'
                ? 'Partial coverage · Deletion blocked'
                : state === 'preview'
                  ? 'One source message · Ready to execute'
                  : state === 'finalization'
                    ? 'Ban succeeded · Case finalization failed'
                    : 'Cleanup completed · One message could not be deleted'}
            </strong>
            <p>
              {state === 'blocked'
                ? 'Discord search did not return complete coverage for the last 24 hours. A time-window cleanup cannot execute from this preview.'
                : state === 'preview'
                  ? 'The single-source exception permits this partial-coverage preview. Only the frozen message below will be considered.'
                  : state === 'finalization'
                    ? 'The member is banned. Closing the case threads failed. Retry only the case updates.'
                    : 'One message was preserved and deleted. Drasil lacked permission to delete the other message.'}
            </p>
          </div>
          <dl className={styles.facts}>
            <Fact label="Operation">
              {finished ? 'Ban and delete messages' : 'Delete messages only'}
            </Fact>
            <Fact label="Scope">
              {state === 'blocked' || finished ? 'Last 24 hours' : 'Source message'}
            </Fact>
            <Fact label="Previewed">
              <Timestamp value={job.previewedAt ?? job.createdAt} />
            </Fact>
            <Fact label="Reason">
              {state === 'blocked'
                ? 'Remove reviewed messages from the last 24 hours.'
                : job.reason}
            </Fact>
            <Fact label="Evidence">Case evidence thread</Fact>
            {finished ? (
              <>
                <Fact label="Ban">Succeeded</Fact>
                <Fact label="Case finalization">Failed · threads remain unresolved</Fact>
              </>
            ) : null}
          </dl>
          {finished ? (
            <dl className={styles.outcomes}>
              <Fact label="Candidates">2</Fact>
              <Fact label="Preserved">1</Fact>
              <Fact label="Deleted">1</Fact>
              <Fact label="Permission denied">1</Fact>
            </dl>
          ) : null}
          <section className={styles.section}>
            <h3>{finished ? 'Message outcomes' : 'Frozen candidates'}</h3>
            <div className={styles.messages}>
              {job.items.map((item) => (
                <article className={styles.message} key={item.id}>
                  <div className={styles.messageHeader}>
                    <strong>Channel {item.channelId}</strong>
                    <Timestamp value={item.messageCreatedAt} />
                    <span
                      className={item.status === 'permission_denied' ? styles.danger : styles.muted}
                    >
                      {item.status === 'pending'
                        ? 'Awaiting execution'
                        : item.status === 'permission_denied'
                          ? 'Permission denied'
                          : 'Deleted'}
                    </span>
                  </div>
                  <p>{item.contentPreview}</p>
                  <div className={styles.messageMeta}>
                    <span>{item.attachmentCount} attachments</span>
                    <span>
                      {item.evidenceStatus === 'preserved'
                        ? 'Evidence preserved'
                        : 'Evidence not yet preserved'}
                    </span>
                  </div>
                  <div className={styles.messageLinks}>
                    {item.sourceMessageUrl ? (
                      <a href={item.sourceMessageUrl} target="_blank" rel="noreferrer">
                        Open source message
                      </a>
                    ) : null}
                    {item.evidenceMessageUrl ? (
                      <a href={item.evidenceMessageUrl} target="_blank" rel="noreferrer">
                        Open preserved evidence
                      </a>
                    ) : null}
                  </div>
                  {item.failureReason ? (
                    <p className={styles.danger}>{item.failureReason}</p>
                  ) : null}
                  <details className={styles.disclosure}>
                    <summary>Message details</summary>
                    <dl className={styles.facts}>
                      <Fact label="Message ID">{item.messageId}</Fact>
                      <Fact label="Author ID">{item.authorId}</Fact>
                      <Fact label="Discovery">{item.discoverySource.split('_').join(' ')}</Fact>
                    </dl>
                  </details>
                </article>
              ))}
            </div>
          </section>
          <div className={styles.actions}>
            {state === 'preview' ? (
              <ToolAction
                onAction={onAction}
                action={{
                  id: 'cleanup-delete-frozen',
                  label: 'Delete 1 message',
                  tone: 'danger',
                  effect:
                    'Preserve evidence and delete the one frozen source message if it is unchanged. Skip changed or missing messages and report individual outcomes. Do not ban or resolve the case.',
                }}
              />
            ) : null}
            {state === 'finalization' || state === 'results' ? (
              <ToolAction
                onAction={onAction}
                action={{
                  id: 'cleanup-retry-finalization',
                  label: 'Retry case finalization',
                  effect:
                    'Retry the case and thread updates for the already successful ban. Do not ban again or repeat message deletion.',
                }}
              />
            ) : (
              <ToolAction
                onAction={onAction}
                action={{
                  id: `cleanup-new-preview-${state}`,
                  label: state === 'blocked' ? 'Preview narrower scope' : 'Create new preview',
                  reason: 'required',
                  effect:
                    'Create a new source-message preview. Keep this job and its frozen candidates in history.',
                }}
              />
            )}
          </div>
          {state === 'preview' ? (
            <p className={styles.footnote}>
              Changed messages are skipped. A message is deleted only after its evidence is
              preserved.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function CaseToolStudy({
  view,
  onAction,
}: {
  readonly view: ToolView;
  readonly onAction: (action: StudyAction) => void;
}) {
  switch (view.kind) {
    case 'quarantine':
      return <QuarantineStudy state={view.state} onAction={onAction} />;
    case 'security':
      return <SecurityStudy state={view.state} onAction={onAction} />;
    case 'cleanup':
      return <CleanupStudy key={view.state} state={view.state} onAction={onAction} />;
  }
}
