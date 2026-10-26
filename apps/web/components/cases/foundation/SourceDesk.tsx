'use client';

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import type { CaseDetail } from '@drasil/contracts';
import { Timestamp } from '@/components/workspace/Timestamp';
import { recordLabel } from '../caseRecordLabel';
import styles from './SourceDesk.module.css';

interface SourceRecord {
  readonly id: string;
  readonly label: string;
  readonly content: string | null;
  readonly at: string | null;
  readonly url: string | null;
  readonly message: boolean;
}
interface SourceGroup {
  readonly url: string | null;
  readonly records: SourceRecord[];
}

function followSource(event: MouseEvent<HTMLAnchorElement>) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById(event.currentTarget.hash.slice(1));
  if (!target) return;
  event.preventDefault();
  const sectionHeading = target.dataset.sourceSection
    ? document.getElementById(target.dataset.sourceSection)?.parentElement
    : null;
  if (sectionHeading) {
    const spacing =
      sectionHeading.getBoundingClientRect().height +
      Number.parseFloat(window.getComputedStyle(sectionHeading).marginBottom);
    target.style.setProperty('--conversation-heading-space', `${spacing}px`);
  }
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
  return target.dataset.sourceSection ?? target.id;
}

function SourceMark({ message }: { readonly message: boolean }) {
  return (
    <span className={styles.mark} data-kind={message ? 'message' : 'report'} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        {message ? (
          <>
            <path d="M5 4h14v12H9l-4 4V4Z" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9 8h6M9 12h4" stroke="currentColor" strokeWidth="1.4" />
          </>
        ) : (
          <>
            <circle cx="12" cy="8" r="4" fill="currentColor" />
            <path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z" fill="currentColor" />
          </>
        )}
      </svg>
    </span>
  );
}

function SavedMessage({
  record,
  heading = true,
  highlight = false,
  link = false,
}: {
  readonly record: SourceRecord;
  readonly heading?: boolean;
  readonly highlight?: boolean;
  readonly link?: boolean;
}) {
  return (
    <article className={styles.message} data-source-message={highlight || undefined}>
      <SourceMark message={record.message} />
      <div className={styles.messageBody}>
        <header>
          {heading ? <h4>{record.label}</h4> : null}
          {record.at ? (
            <Timestamp value={record.at} prefix={record.message ? undefined : 'Recorded'} />
          ) : (
            <span>Time not recorded</span>
          )}
          {link && record.url ? (
            <a
              className={styles.messageLink}
              href={record.url}
              target="_blank"
              rel="noreferrer"
              title="View in Discord"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 18 18 6M7 6h11v11" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className={styles.srOnly}>View in Discord in a new tab</span>
            </a>
          ) : null}
        </header>
        <blockquote>{record.content ?? 'Content not recorded.'}</blockquote>
      </div>
    </article>
  );
}

interface ContextLink {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export function SourceDesk({
  detail,
  contextLinks = [],
}: {
  readonly detail: CaseDetail;
  readonly contextLinks?: readonly ContextLink[];
}) {
  const id = useId();
  const reader = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [returnSource, setReturnSource] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (first) setActive(first.target.id);
      },
      { rootMargin: '-88px 0px -60% 0px' }
    );
    reader.current
      ?.querySelectorAll('[data-source-target]')
      .forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [detail, id]);
  const navigate = (event: MouseEvent<HTMLAnchorElement>): string | undefined => {
    const target = followSource(event);
    if (target) setActive(target);
    return target;
  };
  const records: SourceRecord[] = [
    ...detail.messageContext
      .filter((item) => item.isSource)
      .map((item) => ({
        id: `message-${item.id}`,
        label: 'Source message excerpt',
        content: item.contentPreview,
        at: item.createdAt,
        url: item.url,
        message: true,
      })),
    ...detail.evidenceItems.map((item) => ({
      id: `evidence-${item.id}`,
      label: recordLabel(item.kind),
      content: item.content,
      at: item.createdAt,
      url: item.url,
      message: false,
    })),
  ];
  const groups = new Map<string, SourceGroup>();
  for (const record of records) {
    const key = record.url ?? record.id;
    const group = groups.get(key);
    if (group) group.records.push(record);
    else groups.set(key, { url: record.url, records: [record] });
  }
  const surrounding = detail.messageContext.filter((item) => !item.isSource);
  const conversation = [...detail.messageContext].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  const sources = [...groups.values()].map((group, index) => ({
    ...group,
    id: `${id}-source-${index}`,
    label: group.records.some((record) => record.message)
      ? 'Source message'
      : group.records[0].label,
    contextIndex: conversation.findIndex((item) =>
      group.records.some((record) => record.id === `message-${item.id}`)
    ),
  }));
  const selected = active ?? sources[0]?.id;
  const returnSourceId = returnSource ?? sources.find((source) => source.contextIndex >= 0)?.id;
  return (
    <div className={styles.desk}>
      <nav className={styles.index} aria-label="Evidence sources">
        <header>
          <h2>Evidence</h2>
          <span>{detail.messageContext.length} messages</span>
        </header>
        {sources.map((source) => (
          <a
            key={source.id}
            href={`#${source.id}`}
            onClick={navigate}
            aria-current={selected === source.id ? 'location' : undefined}
          >
            <strong>{source.label}</strong>
            {source.records[0].at ? (
              <Timestamp value={source.records[0].at} format="time" />
            ) : (
              <span>Time not recorded</span>
            )}
          </a>
        ))}
        {surrounding.length ? (
          <a
            href={`#${id}-surrounding`}
            onClick={navigate}
            aria-current={selected === `${id}-surrounding` ? 'location' : undefined}
          >
            <strong>Conversation</strong>
            <span>{conversation.length} saved messages</span>
          </a>
        ) : null}
        {contextLinks.length ? (
          <div className={styles.contextJumps}>
            {contextLinks.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={navigate}
                aria-current={selected === link.id ? 'location' : undefined}
              >
                <strong>{link.label}</strong>
                <span>{link.count}</span>
              </a>
            ))}
          </div>
        ) : null}
      </nav>
      <div ref={reader} className={styles.reader}>
        {sources.map((source) => (
          <section
            key={source.id}
            aria-label={
              source.records.length > 1 ? 'Records from one source message' : source.label
            }
          >
            <header className={styles.sourceHeading}>
              <div>
                <h3 id={source.id} tabIndex={-1} data-source-target>
                  {source.label}
                </h3>
                {source.records.length > 1 ? <p>{source.records.length} saved records</p> : null}
              </div>
              <div className={styles.sourceLinks}>
                {surrounding.length && source.contextIndex >= 0 ? (
                  <a
                    href={`#${id}-context-${source.contextIndex}`}
                    onClick={(event) => {
                      if (navigate(event)) setReturnSource(source.id);
                    }}
                  >
                    View conversation
                  </a>
                ) : null}
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    View in Discord<span className={styles.srOnly}> in a new tab</span>
                  </a>
                ) : null}
              </div>
            </header>
            {source.records.map((record) => (
              <SavedMessage key={record.id} record={record} heading={source.records.length > 1} />
            ))}
          </section>
        ))}
        {!sources.length ? <p className={styles.empty}>No source evidence saved.</p> : null}
        {surrounding.length ? (
          <section aria-label="Saved conversation">
            <header className={styles.sourceHeading}>
              <h3 id={`${id}-surrounding`} tabIndex={-1} data-source-target>
                Conversation
              </h3>
              <div className={styles.sourceLinks}>
                <span>{conversation.length} saved messages</span>
                {returnSourceId ? (
                  <a href={`#${returnSourceId}`} onClick={navigate}>
                    Back to source
                  </a>
                ) : null}
              </div>
            </header>
            <div className={styles.conversation}>
              {conversation.map((item, index) => (
                <div
                  key={item.id}
                  id={item.isSource ? `${id}-context-${index}` : undefined}
                  tabIndex={item.isSource ? -1 : undefined}
                  className={styles.contextTarget}
                  data-source-section={item.isSource ? `${id}-surrounding` : undefined}
                >
                  <SavedMessage
                    record={{
                      id: item.id,
                      label: item.isSource ? 'Source message excerpt' : 'Message excerpt',
                      content: item.contentPreview,
                      at: item.createdAt,
                      url: item.url,
                      message: true,
                    }}
                    highlight={item.isSource}
                    link
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
