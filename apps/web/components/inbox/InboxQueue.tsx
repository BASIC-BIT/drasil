'use client';
import { recordLabel } from '@/lib/recordLabel';

import { Timestamp } from '@/components/workspace/Timestamp';
import { serializeInboxLocation, type InboxLocation } from '@/lib/inboxLocation';
import type { ModerationInboxItem, ModerationInboxItemKind } from '@drasil/contracts';
import type { MouseEvent } from 'react';
import styles from './InboxWorkspace.module.css';

export const inboxKindLabels: Record<ModerationInboxItemKind, string> = {
  case: 'Case',
  submitted_report: 'Submitted report',
  observed_alert: 'Observed alert',
  report_attention: 'Reporter follow-up',
  support_attention: 'Support reply',
  pending_screening: 'Pending screening',
};
export function isPlainInboxClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
export interface InboxQueueProps {
  readonly guildId: string;
  readonly items: readonly ModerationInboxItem[];
  readonly location: InboxLocation;
  readonly onSelect: (id: string) => void;
}
export function InboxQueue({ guildId, items, location, onSelect }: InboxQueueProps) {
  return (
    <>
      <h2 className={styles.queueHeading}>
        Inbox <span>{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No inbox items match these filters.</p>
      ) : (
        <ul className={styles.queueList}>
          {items.map((item) => (
            <li key={item.id}>
              <a
                data-inbox-item={item.id}
                aria-current={item.id === location.selectedItemId ? 'true' : undefined}
                href={`/admin/guild/${encodeURIComponent(guildId)}/inbox?${serializeInboxLocation({ ...location, selectedItemId: item.id, trackedRequestId: null })}`}
                onClick={(event) => {
                  if (isPlainInboxClick(event)) {
                    event.preventDefault();
                    onSelect(item.id);
                  }
                }}
              >
                <span className={styles.rowTop}>
                  <strong>{item.subject.displayLabel}</strong>
                  <span data-severity={item.stale ? 'warning' : 'neutral'}>
                    {item.stale ? 'Stale' : recordLabel(item.statusLabel)}
                  </span>
                </span>
                <span>
                  {inboxKindLabels[item.kind]}
                  {item.signalLabel ? ` · ${recordLabel(item.signalLabel)}` : ''}
                </span>
                {item.summary !== null ? (
                  <span className={styles.rowSummary}>{item.summary}</span>
                ) : null}
                <Timestamp value={item.updatedAt} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
