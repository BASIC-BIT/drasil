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
function itemLabel(item: ModerationInboxItem): string {
  if (item.kind !== 'support_attention') return inboxKindLabels[item.kind];
  switch (item.sourceMetadata?.subtype) {
    case 'quarantine_breach':
      return 'Containment breach';
    case 'recovery_reply':
      return 'Recovery reply';
    default:
      return 'Support reply';
  }
}
function sourceDate(item: ModerationInboxItem): { label: string; value: string | null } {
  switch (item.kind) {
    case 'support_attention':
      return {
        label: item.sourceMetadata?.subtype === 'quarantine_breach' ? 'Posted' : 'Reply sent',
        value: item.sourceMetadata?.eventAt ?? null,
      };
    case 'report_attention':
      return { label: 'Reply sent', value: item.sourceMetadata?.eventAt ?? null };
    case 'observed_alert':
      return { label: 'Detected', value: item.sourceMetadata?.eventAt ?? null };
    case 'pending_screening':
      return { label: 'Pending since', value: item.sourceMetadata?.pendingSince ?? null };
    case 'case':
      return { label: 'Opened', value: item.createdAt };
    case 'submitted_report':
      return { label: 'Report created', value: item.createdAt };
  }
}
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
      <h2 className={styles.queueHeading} tabIndex={-1}>
        Inbox <span>{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No inbox items match these filters.</p>
      ) : (
        <ul className={styles.queueList}>
          {items.map((item) => {
            const date = sourceDate(item);
            return (
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
                    <span
                      data-severity={
                        item.sourceMetadata?.subtype === 'quarantine_breach'
                          ? 'danger'
                          : item.stale
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {item.stale ? 'Stale' : recordLabel(item.statusLabel)}
                    </span>
                  </span>
                  <span>
                    {itemLabel(item)}
                    {item.signalLabel ? ` · ${recordLabel(item.signalLabel)}` : ''}
                  </span>
                  {item.summary !== null ? (
                    <span className={styles.rowSummary}>{item.summary}</span>
                  ) : null}
                  <span className={styles.rowDate}>
                    <Timestamp prefix={date.label} value={date.value} />
                  </span>
                  {item.updatedAt !== date.value ? (
                    <span className={styles.rowDate}>
                      <Timestamp prefix="Queue updated" value={item.updatedAt} />
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
