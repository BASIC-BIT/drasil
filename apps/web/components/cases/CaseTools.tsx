'use client';

import type { ReactNode } from 'react';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceActions, WorkspaceMutation } from '@/lib/workspaceActionTypes';
import { findAccountQuarantineActionRequests } from '@/lib/inboxActionReceipts';
import { filterCaseKindActions } from '@/lib/caseActionEligibility';
import { AccountQuarantinePanel } from './AccountQuarantinePanel';

export interface CaseToolsProps {
  readonly data: CaseWorkspaceData;
  readonly actions: WorkspaceActions;
  readonly returnHref: string;
  readonly children?: ReactNode;
}
export function CaseTools({ data, actions, returnHref, children }: CaseToolsProps) {
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
  return (
    <>
      {detail.caseKind === 'compromised_account' ||
      caseActions.includes('quarantine_compromised_account') ? (
        <AccountQuarantinePanel
          key={`${detail.guildId}:${detail.id}:${detail.userId}`}
          data={data}
          requests={{ execute: requests.execute, preview: ownRequests.preview ?? requests.preview }}
          policy={data.policy}
          submissions={{ preview: quarantine, execute: quarantine, release }}
        />
      ) : null}
      {children}
    </>
  );
}
