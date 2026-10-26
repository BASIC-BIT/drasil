'use client';

import type { EvidenceSourceGroup } from '@/lib/evidenceSources';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import { useRef, useState, type ReactNode } from 'react';
import { CaseTools } from './CaseTools';
import { CaseWorkspaceView } from './CaseWorkspaceView';
import { ChannelConversation } from './ChannelConversation';
import type { CaseMessageCleanupIntegration } from './caseToolBindings';

export interface CaseCleanupActions {
  readonly preview: (
    guildId: string,
    caseId: string,
    ...args: Parameters<CaseMessageCleanupIntegration['previewAction']>
  ) => ReturnType<CaseMessageCleanupIntegration['previewAction']>;
  readonly execute: (
    guildId: string,
    caseId: string,
    ...args: Parameters<CaseMessageCleanupIntegration['executeAction']>
  ) => ReturnType<CaseMessageCleanupIntegration['executeAction']>;
  readonly ban: (
    guildId: string,
    caseId: string,
    ...args: Parameters<CaseMessageCleanupIntegration['combinedBanAction']>
  ) => ReturnType<CaseMessageCleanupIntegration['combinedBanAction']>;
}

export function CaseWorkspaceController({
  data,
  actions,
  cleanupActions,
  actionArea,
  maintenance,
  returnHref,
}: {
  readonly data: CaseWorkspaceData;
  readonly actions: WorkspaceActions;
  readonly cleanupActions?: CaseCleanupActions;
  readonly actionArea: ReactNode;
  readonly maintenance: ReactNode;
  readonly returnHref: string;
}) {
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  // Resolve each render from the latest completed read. Never retain a descriptor
  // after its record/channel/message binding changes or disappears.
  const source = data.conversationSources?.find(
    (candidate) =>
      `${candidate.recordKind}:${candidate.recordId}:${candidate.sourceKey}` === sourceKey
  );
  function open(group: EvidenceSourceGroup): void {
    const descriptor = data.conversationSources?.find(
      (candidate) =>
        candidate.guildId === data.detail.guildId &&
        candidate.channelId === group.channelId &&
        candidate.messageId === group.messageId &&
        (candidate.recordKind === 'case'
          ? candidate.recordId === data.detail.id
          : candidate.recordId === data.report?.id)
    );
    sourceTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSourceKey(
      descriptor
        ? `${descriptor.recordKind}:${descriptor.recordId}:${descriptor.sourceKey}`
        : 'unavailable'
    );
  }
  function back(): void {
    setSourceKey(null);
    sourceTrigger.current?.focus();
    sourceTrigger.current?.scrollIntoView({ block: 'center' });
  }
  const cleanup =
    data.cleanup && cleanupActions
      ? {
          workspace: data.cleanup.workspace,
          deleteOnlyJob: data.cleanup.jobs.find((job) => job.mode === 'delete_only') ?? null,
          combinedJob: data.cleanup.jobs.find((job) => job.mode === 'ban_with_cleanup') ?? null,
          previewAction: cleanupActions.preview.bind(null, data.detail.guildId, data.detail.id),
          executeAction: cleanupActions.execute.bind(null, data.detail.guildId, data.detail.id),
          combinedBanAction: cleanupActions.ban.bind(null, data.detail.guildId, data.detail.id),
          requests: data.requests,
          loadedAt: data.loadedAt,
          returnHref,
        }
      : undefined;
  return (
    <CaseWorkspaceView
      data={data}
      returnHref={returnHref}
      actionArea={actionArea}
      tools={
        <CaseTools
          data={data}
          actions={actions}
          returnHref={returnHref}
          cleanup={cleanup}
          collapsible
        >
          {maintenance}
        </CaseTools>
      }
      onOpenConversation={open}
      conversation={
        sourceKey ? (
          source ? (
            <ChannelConversation source={source} onBackToSource={back} />
          ) : (
            <section aria-label="Channel conversation">
              <p>This conversation is no longer available.</p>
              <button onClick={back}>Back to source</button>
            </section>
          )
        ) : null
      }
    />
  );
}
