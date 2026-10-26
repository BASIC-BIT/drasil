'use client';

import { submitWorkspaceCaseAction } from '@/app/admin/guild/[guildId]/cases/actions';
import {
  banCaseUserWithMessageCleanup,
  executeCaseMessageCleanup,
  previewCaseMessageCleanup,
} from '@/app/admin/guild/[guildId]/cases/messageCleanupActions';
import {
  submitWorkspaceAttentionAction,
  submitWorkspaceObservedAction,
} from '@/app/admin/guild/[guildId]/inbox/actions';
import { submitWorkspaceReportAction } from '@/app/admin/guild/[guildId]/reports/actions';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { InboxItemDetail, matchingInboxRequests } from '@/components/inbox/InboxItemDetail';
import { InboxWorkspace } from '@/components/inbox/InboxWorkspace';
import { explicitInboxReturnHref, type InboxLocation } from '@/lib/inboxLocation';
import {
  workspaceItemDetailSchema,
  type WorkspaceItemDetail,
} from '@/lib/moderationWorkspaceTypes';
import type { ModerationInboxItem } from '@drasil/contracts';
import { useCallback } from 'react';

const actions = {
  caseAction: submitWorkspaceCaseAction,
  reportAction: submitWorkspaceReportAction,
  attentionAction: submitWorkspaceAttentionAction,
  observedAction: submitWorkspaceObservedAction,
};
const cleanupActions = {
  preview: previewCaseMessageCleanup,
  execute: executeCaseMessageCleanup,
  ban: banCaseUserWithMessageCleanup,
};

export function ModerationInboxRoute({
  guildId,
  items,
  initialLocation,
}: {
  readonly guildId: string;
  readonly items: readonly ModerationInboxItem[];
  readonly initialLocation: InboxLocation;
}) {
  const loadDetail = useCallback(
    async (itemId: string, signal: AbortSignal) => {
      const response = await fetch(
        `/api/admin/guild/${encodeURIComponent(guildId)}/inbox/${encodeURIComponent(itemId)}`,
        { cache: 'no-store', signal }
      );
      if (!response.ok) throw new Error('Item unavailable.');
      return workspaceItemDetailSchema.parse(await response.json());
    },
    [guildId]
  );
  return (
    <InboxWorkspace
      guildId={guildId}
      items={items}
      initialLocation={initialLocation}
      loadDetail={loadDetail}
      actions={actions}
      cleanupActions={cleanupActions}
    />
  );
}

export function ModerationRecordRoute({
  detail,
  loadedAt,
  returnHref,
}: {
  readonly detail: WorkspaceItemDetail;
  readonly loadedAt: string;
  readonly returnHref: string;
}) {
  return (
    <InboxActionRequestPollingProvider enabled serverRequests={matchingInboxRequests(detail)}>
      {detail.kind !== 'case' ? (
        <a href={explicitInboxReturnHref(detail.item.guildId, returnHref)}>← Back to inbox</a>
      ) : null}
      <InboxItemDetail
        detail={detail}
        loadedAt={loadedAt}
        returnHref={returnHref}
        trackedRequestId={null}
        onTrackedRequest={() => undefined}
        actions={actions}
        cleanupActions={cleanupActions}
      />
    </InboxActionRequestPollingProvider>
  );
}
