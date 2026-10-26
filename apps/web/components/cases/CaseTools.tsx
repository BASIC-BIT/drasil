'use client';

import { useId, useState, type ReactNode } from 'react';
import { ActionButton } from '@/components/workspace/Foundation';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceActions, WorkspaceMutation } from '@/lib/workspaceActionTypes';
import { findAccountQuarantineActionRequests } from '@/lib/inboxActionReceipts';
import { filterCaseKindActions } from '@/lib/caseActionEligibility';
import { MessageCleanupPanel } from './MessageCleanupPanel';
import type { CaseMessageCleanupIntegration } from './caseToolBindings';
import { BrowserSecurityPanel } from './BrowserSecurityPanel';
import { AccountQuarantinePanel } from './AccountQuarantinePanel';
import styles from './CaseTools.module.css';

export interface CaseToolsProps {
  readonly data: CaseWorkspaceData;
  readonly actions: WorkspaceActions;
  readonly returnHref: string;
  readonly children?: ReactNode;
  readonly cleanup?: CaseMessageCleanupIntegration;
  readonly collapsible?: boolean;
}
export function CaseTools({
  data,
  actions,
  returnHref,
  children,
  cleanup,
  collapsible = false,
}: CaseToolsProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const { detail } = data;
  const caseActions = filterCaseKindActions(detail, detail.allowedActions);
  const quarantine: WorkspaceMutation = (form) => {
    form.set('returnTo', returnHref);
    return actions.caseAction(
      { guildId: detail.guildId, caseId: detail.id, action: 'quarantine_compromised_account' },
      form
    );
  };
  const release: WorkspaceMutation = (form) => {
    form.set('returnTo', returnHref);
    return actions.caseAction(
      { guildId: detail.guildId, caseId: detail.id, action: 'verify_user' },
      form
    );
  };
  const requests = findAccountQuarantineActionRequests(
    data.requests.filter((request) => request.targetUserId === detail.userId),
    detail.id
  );
  const ownRequests = findAccountQuarantineActionRequests(
    data.requests.filter(
      (request) =>
        request.targetUserId === detail.userId && request.actorUserId === data.actorUserId
    ),
    detail.id
  );
  const scopedRequests = data.requests.filter(
    (request) => request.verificationEventId === detail.id && request.targetUserId === detail.userId
  );
  const hasRequest = (types: readonly string[]) =>
    scopedRequests.some((request) => types.includes(request.actionType));
  const relevant = {
    quarantine:
      detail.caseKind === 'compromised_account' || !!requests.preview || !!requests.execute,
    security:
      !!detail.captchaChallenge ||
      hasRequest([
        'request_captcha_challenge',
        'retry_captcha_challenge',
        'bypass_captcha_challenge',
      ]),
    cleanup:
      !!cleanup?.deleteOnlyJob ||
      !!cleanup?.combinedJob ||
      hasRequest([
        'preview_case_message_deletion',
        'execute_case_message_deletion',
        'ban_case_user_with_message_cleanup',
      ]),
    maintenance: hasRequest([
      'refresh_case_notification',
      'repair_active_case',
      'reopen_case',
      'sync_existing_ban',
    ]),
  };
  const controlled = Object.entries(relevant)
    .filter(([, active]) => !active)
    .map(([kind]) => `${id}-${kind}`)
    .join(' ');
  // Fixed slots keep confirmations, drafts and receipts mounted as relevance changes.
  return (
    <div className={styles.tools}>
      {collapsible && controlled ? (
        <ActionButton
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={controlled}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Case tools
        </ActionButton>
      ) : null}
      <div id={`${id}-quarantine`} hidden={collapsible && !expanded && !relevant.quarantine}>
        {detail.caseKind === 'compromised_account' ||
        caseActions.includes('quarantine_compromised_account') ? (
          <AccountQuarantinePanel
            key={`${detail.guildId}:${detail.id}:${detail.userId}`}
            data={data}
            requests={{
              execute: requests.execute,
              preview: ownRequests.preview ?? requests.preview,
            }}
            policy={data.policy}
            submissions={{ preview: quarantine, execute: quarantine, release }}
          />
        ) : null}
      </div>
      <div id={`${id}-security`} hidden={collapsible && !expanded && !relevant.security}>
        <BrowserSecurityPanel
          key={`security:${detail.guildId}:${detail.id}:${detail.userId}`}
          detail={detail}
          configuration={data.securityCheckConfiguration}
          policy={data.policy}
          requests={data.requests}
          loadedAt={data.loadedAt}
          returnHref={returnHref}
          submissions={{
            issue: (form) =>
              actions.caseAction(
                { guildId: detail.guildId, caseId: detail.id, action: 'challenge_user' },
                form
              ),
            retry: (form) =>
              actions.caseAction(
                { guildId: detail.guildId, caseId: detail.id, action: 'retry_captcha' },
                form
              ),
            bypass: (form) =>
              actions.caseAction(
                { guildId: detail.guildId, caseId: detail.id, action: 'bypass_captcha' },
                form
              ),
          }}
        />
      </div>
      <div id={`${id}-cleanup`} hidden={collapsible && !expanded && !relevant.cleanup}>
        {cleanup &&
        cleanup.workspace.guildId === detail.guildId &&
        cleanup.workspace.verificationEventId === detail.id &&
        cleanup.workspace.targetUserId === detail.userId ? (
          <MessageCleanupPanel
            integration={{
              ...cleanup,
              loadedAt: data.loadedAt,
              requests: data.requests,
              returnHref,
            }}
            policy={data.policy}
          />
        ) : null}
      </div>
      <div id={`${id}-maintenance`} hidden={collapsible && !expanded && !relevant.maintenance}>
        {children}
      </div>
    </div>
  );
}
