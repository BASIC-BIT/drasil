'use client';

import { useEffect, useState } from 'react';
import type { CaseWorkspaceData, WorkspaceActionPolicy } from '@/lib/moderationWorkspaceTypes';
import type { AccountQuarantineActionRequests } from '@/lib/inboxActionReceipts';
import type { AccountQuarantineRoleSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { WorkspaceMutation } from '@/lib/workspaceActionTypes';
import { ConfirmedAction } from '@/components/workspace/actions/ConfirmedAction';
import { Timestamp } from '@/components/workspace/Timestamp';
import { recordLabel } from './caseRecordLabel';
import styles from './AccountQuarantinePanel.module.css';

const PREVIEW_MAX_AGE = 10 * 60 * 1000;
export interface AccountQuarantinePanelProps {
  readonly data: CaseWorkspaceData;
  readonly requests: AccountQuarantineActionRequests;
  readonly policy: WorkspaceActionPolicy;
  readonly submissions: {
    readonly preview: WorkspaceMutation;
    readonly execute: WorkspaceMutation;
    readonly release: WorkspaceMutation;
  };
}
function roleLabel(role: AccountQuarantineRoleSummary): string {
  return `${role.roleName ? `${role.roleName} (${role.roleId})` : role.roleId}${role.reason ? ` · ${role.reason}` : ''}`;
}
export function AccountQuarantinePanel({
  data,
  requests,
  policy,
  submissions,
}: AccountQuarantinePanelProps) {
  const { detail } = data;
  const [now, setNow] = useState(Date.now);
  const [submittedPreviewId, setSubmittedPreviewId] = useState<string | null>(null);
  const [refreshRequestId, setRefreshRequestId] = useState<string | null>(null);
  const saved = requests.preview?.accountQuarantinePreview
    ? requests.preview
    : (data.requests.find(
        (request) =>
          request.actionType === 'preview_account_quarantine' &&
          request.status === 'completed' &&
          request.accountQuarantinePreview &&
          request.verificationEventId === detail.id &&
          request.targetUserId === detail.userId &&
          request.actorUserId === data.actorUserId
      ) ?? requests.preview);
  const preview = saved?.accountQuarantinePreview;
  const previewedAt = Date.parse(preview?.previewedAt ?? '');
  const completedAt = Date.parse(saved?.completedAt ?? '');
  // One expiration timer updates an already-open confirmation; polling stays with the shared provider.
  useEffect(() => {
    setNow(Date.now());
    const remaining = Math.min(previewedAt, completedAt) + PREVIEW_MAX_AGE - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 1);
    return () => clearTimeout(timer);
  }, [previewedAt, completedAt]);
  const matches = (request: NonNullable<typeof saved>) =>
    request.verificationEventId === detail.id && request.targetUserId === detail.userId;
  const latestOwn = data.requests.find(
    (request) =>
      matches(request) &&
      request.actorUserId === data.actorUserId &&
      request.actionType === 'preview_account_quarantine' &&
      request.status === 'completed'
  );
  const parked = detail.attentionState === 'parked';
  const execution =
    requests.execute &&
    matches(requests.execute) &&
    requests.execute.actionType === 'quarantine_compromised_account'
      ? requests.execute
      : null;
  const previewRequest =
    requests.preview &&
    matches(requests.preview) &&
    requests.preview.actionType === 'preview_account_quarantine'
      ? requests.preview
      : null;
  const active = (status: string | undefined) => status === 'queued' || status === 'processing';
  const running =
    detail.containmentStatus === 'in_progress' ||
    active(execution?.status) ||
    active(previewRequest?.status);
  const fresh = Boolean(
    data.actorUserId &&
    saved?.actorUserId === data.actorUserId &&
    saved?.status === 'completed' &&
    !(execution?.status === 'failed' && execution.accountQuarantinePreviewRequestId === saved.id) &&
    latestOwn?.id === saved?.id &&
    preview?.enabled &&
    previewedAt <= now &&
    completedAt <= now &&
    previewedAt > now - PREVIEW_MAX_AGE &&
    completedAt > now - PREVIEW_MAX_AGE
  );
  const target = {
    kind: 'case',
    guildId: detail.guildId,
    recordId: detail.id,
    targetUserId: detail.userId,
    label: `${detail.userIdentity.displayLabel} · ${detail.userId} · ${detail.id}`,
    loadedAt: data.loadedAt,
  } as const;
  const allowed = (action: 'quarantine_compromised_account' | 'verify_user') =>
    policy.canQueueCaseActions &&
    policy.allowedActions.includes(action) &&
    detail.allowedActions.includes(action);
  const effects = detail.quarantineEffects;
  const thread = detail.surfaces.find((surface) => surface.kind === 'verification_thread');
  const submittedExecution = submittedPreviewId
    ? data.requests.find(
        (request) =>
          matches(request) &&
          request.actionType === 'quarantine_compromised_account' &&
          request.accountQuarantinePreviewRequestId === submittedPreviewId
      )
    : null;
  const boundExecution = submittedExecution ?? execution;
  const executeRequest =
    boundExecution &&
    (boundExecution.accountQuarantinePreviewRequestId === saved?.id ||
      (submittedPreviewId !== null &&
        boundExecution.accountQuarantinePreviewRequestId === submittedPreviewId))
      ? boundExecution
      : null;
  return (
    <section className={styles.panel} aria-label="Account containment and recovery">
      <h2>Account containment and recovery</h2>
      <p
        className={styles.state}
        data-severity={detail.containmentStatus === 'incomplete' ? 'warning' : 'neutral'}
      >
        {detail.containmentStatus === 'incomplete'
          ? 'Containment incomplete'
          : recordLabel(detail.containmentStatus ?? 'not_applicable')}{' '}
        · {parked ? 'Parked for recovery' : 'Review required'}
      </p>
      {parked ? (
        <p>
          Parked by {detail.parkedBy ?? 'unknown moderator'} ·{' '}
          <Timestamp value={detail.parkedAt ?? null} />
        </p>
      ) : null}
      {effects ? (
        <dl className={styles.effects}>
          <dt>Roles removed</dt>
          <dd>{effects.removedRoleCount}</dd>
          <dt>Roles retained</dt>
          <dd>{effects.retainedRoleCount}</dd>
          <dt>Failed role removals</dt>
          <dd>{effects.failedRoleCount}</dd>
          <dt>Member/channel bypasses</dt>
          <dd>{effects.memberBypassCount}</dd>
        </dl>
      ) : null}
      {execution?.resultSummary ? <p>{execution.resultSummary}</p> : null}
      {execution?.lastError ? <p className={styles.warning}>{execution.lastError}</p> : null}
      {thread ? (
        <a href={thread.url} target="_blank" rel="noreferrer">
          Recovery thread
        </a>
      ) : (
        <p>Recovery thread not recorded.</p>
      )}
      {data.recoveryAttention?.map((item) => (
        <p key={item.id}>
          <a href={`/admin/guild/${detail.guildId}/inbox?item=${encodeURIComponent(item.id)}`}>
            {item.title}
          </a>{' '}
          · <Timestamp value={item.updatedAt} />
          {item.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </p>
      ))}
      {parked ? (
        <p>
          Acknowledging a recovery reply or breach clears attention only. Account recovery and
          quarantine release require a separate decision.
        </p>
      ) : null}
      {preview && saved ? (
        <section className={styles.preview} aria-label="Saved quarantine preview">
          <h3>Saved preview</h3>
          <p>
            <Timestamp value={preview.previewedAt} /> · Moderator{' '}
            {saved.actorUserId ?? 'not recorded'} · Request {saved.id}
          </p>
          {!fresh ? (
            <p className={styles.warning}>
              This preview cannot be executed. Refresh quarantine preview before another attempt.
            </p>
          ) : null}
          <p>
            {preview.canContain
              ? 'Previewed containment has no recorded blockers.'
              : 'Incomplete containment remains in review; execution can retain partial role removals.'}
          </p>
          <dl className={styles.effects}>
            <dt>Roles to remove</dt>
            <dd>{preview.plannedRoles.length}</dd>
            <dt>Privileged roles to remove</dt>
            <dd>{preview.privilegedRoles.length}</dd>
            <dt>Roles that cannot be removed</dt>
            <dd>{preview.retainedRoles.length}</dd>
            <dt>Member/channel bypasses</dt>
            <dd>{preview.memberBypassCount}</dd>
            <dt>Lockdown issues / errors / changes required</dt>
            <dd>
              {preview.lockdownIssueCount} / {preview.lockdownErrorCount} /{' '}
              {preview.lockdownPlannedActionCount}
            </dd>
            <dt>Case role retained</dt>
            <dd>
              {preview.caseRole ? roleLabel(preview.caseRole) : 'Not configured'} ·{' '}
              {preview.caseRoleReady ? 'Ready' : 'Repair required'}
            </dd>
            <dt>Recovery thread retained</dt>
            <dd>
              {preview.recoveryThreadId ?? 'Not recorded'} ·{' '}
              {preview.recoveryThreadReady ? 'Ready' : 'Repair required'}
            </dd>
            <dt>Admin notification</dt>
            <dd>{preview.adminNotificationReady ? 'Ready' : 'Repair required'}</dd>
          </dl>
          {[
            { label: 'Remove', roles: preview.plannedRoles },
            { label: 'Privileged', roles: preview.privilegedRoles },
            { label: 'Retained', roles: preview.retainedRoles },
          ].map((group) =>
            group.roles.length ? (
              <div key={group.label}>
                <h4>{group.label}</h4>
                <ul>
                  {group.roles.map((role) => (
                    <li key={role.roleId}>{roleLabel(role)}</li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
          {preview.unremovablePrivilegeReasons.length ? (
            <ul>
              {preview.unremovablePrivilegeReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {preview.lockdownIssues?.map((issue, index) => (
            <p key={index}>
              {issue.severity} · {issue.code}: {issue.message}
            </p>
          ))}
          {preview.memberBypasses?.map((bypass, index) => (
            <p key={index}>
              <a
                href={`https://discord.com/channels/${detail.guildId}/${bypass.channelId}`}
                target="_blank"
                rel="noreferrer"
              >
                {bypass.channelName}
              </a>{' '}
              · {bypass.subjectType} {bypass.subjectId} · {bypass.permissions.join(', ')}
            </p>
          ))}
          <p>
            The member stays in the server, the recovery thread stays open, and no Discord timeout
            is applied.
          </p>
          <ConfirmedAction
            key={refreshRequestId === saved.id ? `refreshed:${saved.id}` : 'execution'}
            target={target}
            action={{
              id: 'quarantine_compromised_account',
              label: 'Attempt account quarantine',
              tone: 'warning',
              description: `Use saved preview ${saved.id}, recorded ${preview.previewedAt ?? 'at an unknown time'}, only if the member and server still match. Remove the previewed roles while retaining the case role and recovery access. Incomplete containment stays in review.`,
              reasonRequired: true,
              disabled: !fresh || running || parked || !allowed('quarantine_compromised_account'),
              fields: [
                { name: 'quarantinePhase', value: 'execute' },
                { name: 'previewRequestId', value: saved.id },
              ],
            }}
            submit={async (form) => {
              setSubmittedPreviewId(String(form.get('previewRequestId') ?? ''));
              return submissions.execute(form);
            }}
            durableRequest={executeRequest}
            record={detail}
          />
        </section>
      ) : null}
      {!parked && detail.status === 'pending' ? (
        <ConfirmedAction
          key={previewRequest?.status === 'completed' ? previewRequest.id : 'preview'}
          target={target}
          action={{
            id: 'quarantine_compromised_account',
            label: preview ? 'Refresh quarantine preview' : 'Preview account quarantine',
            description:
              'Read current role removals, retained privileges, channel bypasses and recovery readiness. The member stays in the server.',
            disabled: !allowed('quarantine_compromised_account') || running,
            fields: [{ name: 'quarantinePhase', value: 'preview' }],
          }}
          submit={async (form) => {
            const result = await submissions.preview(form);
            if (result.kind === 'request' && result.receipt.status !== 'failed') {
              setRefreshRequestId(result.receipt.id);
              setSubmittedPreviewId(null);
            }
            return result;
          }}
          durableRequest={previewRequest?.status === 'completed' ? null : previewRequest}
          record={detail}
        />
      ) : null}
      {allowed('verify_user') ? (
        <ConfirmedAction
          target={target}
          action={{
            id: 'verify_user',
            label: 'Verify and release',
            tone: 'positive',
            description:
              'Confirm account recovery, release quarantine, restore eligible snapshotted roles under the current role policy, and resolve the verification case.',
            disabled: running,
          }}
          submit={submissions.release}
          durableRequest={
            data.requests.find(
              (request) => matches(request) && request.actionType === 'verify_case_user'
            ) ?? null
          }
          record={detail}
        />
      ) : null}
    </section>
  );
}
