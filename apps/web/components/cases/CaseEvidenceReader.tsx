'use client';

import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import type { CaseDetail, ReportDetail } from '@drasil/contracts';
import { groupEvidenceSources, type EvidenceSourceGroup } from '@/lib/evidenceSources';
import { Timestamp } from '@/components/workspace/Timestamp';
import { CaseEvidenceRecord } from './CaseEvidenceRecord';
import styles from './CaseEvidenceReader.module.css';

export interface CaseEvidenceReaderProps {
  readonly detail: CaseDetail;
  readonly report: ReportDetail | null;
  readonly onOpenConversation?: (source: EvidenceSourceGroup) => void;
  readonly onContextJump?: (sourceTargetId: string) => void;
  readonly regions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly content: ReactNode;
  }[];
  readonly contextLinks?: readonly {
    readonly id: string;
    readonly label: string;
    readonly count: number;
  }[];
}

export function CaseEvidenceReader({
  detail,
  report,
  onOpenConversation,
  onContextJump,
  regions = [],
  contextLinks = [],
}: CaseEvidenceReaderProps) {
  const id = useId();
  const [active, setActive] = useState<string | null>(null);
  const [returnSource, setReturnSource] = useState<string | null>(null);
  const groups = groupEvidenceSources({ detail, report });
  const sources = groups.map((group, index) => ({
    ...group,
    targetId: `${id}-source-${index}`,
    label:
      group.kind === 'recent_member_previews'
        ? `Recent member previews · ${group.channelId ? `Channel ID ${group.channelId}` : 'Channel not recorded'}`
        : group.messageId
          ? 'Source message'
          : group.records[0].label,
  }));
  const navigate = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(event.currentTarget.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    setActive(target.id);
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  };
  return (
    <div className={styles.desk}>
      <nav className={styles.index} aria-label="Evidence sources">
        <header>
          <h2>Evidence</h2>
          <span>
            {groups.reduce((total, group) => total + group.records.length, 0)} saved records
          </span>
        </header>
        {regions.map((region) => (
          <a
            key={region.id}
            href={`#${region.id}`}
            onClick={navigate}
            aria-current={(active ?? regions[0]?.id) === region.id ? 'location' : undefined}
          >
            <strong>{region.label}</strong>
          </a>
        ))}
        {sources.map((source) => (
          <a
            key={source.id}
            href={`#${source.targetId}`}
            onClick={navigate}
            aria-current={
              (active ?? regions[0]?.id ?? sources[0]?.targetId) === source.targetId
                ? 'location'
                : undefined
            }
          >
            <strong>{source.label}</strong>
            <Timestamp value={source.records[0].createdAt} format="time" />
          </a>
        ))}
        <div className={styles.contextJumps}>
          {contextLinks.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              onClick={(event) => {
                const sourceTarget =
                  sources.find((source) => source.targetId === active)?.targetId ??
                  sources[0]?.targetId;
                setReturnSource(sourceTarget ?? null);
                if (sourceTarget) onContextJump?.(sourceTarget);
                navigate(event);
              }}
            >
              <strong>{link.label}</strong>
              <span>{link.count}</span>
            </a>
          ))}
        </div>
        {returnSource ? (
          <a href={`#${returnSource}`} onClick={navigate}>
            Back to source
          </a>
        ) : null}
      </nav>
      <div className={styles.reader}>
        {regions.map((region) => (
          <section
            key={region.id}
            id={region.id}
            tabIndex={-1}
            className={styles.injectedRegion}
            aria-label={region.label}
          >
            {region.content}
            {returnSource ? (
              <a className={styles.previewLink} href={`#${returnSource}`} onClick={navigate}>
                Back to source
              </a>
            ) : null}
          </section>
        ))}
        {sources.map((source) => (
          <section
            key={source.id}
            aria-label={
              source.kind === 'saved_source' && source.records.length > 1
                ? 'Records from one source message'
                : source.label
            }
          >
            <header className={styles.sourceHeading}>
              <div>
                <h3 id={source.targetId} tabIndex={-1}>
                  {source.label}
                </h3>
                {source.records.length > 1 ? <p>{source.records.length} saved records</p> : null}
              </div>
              <div className={styles.sourceLinks}>
                {source.kind === 'saved_source' &&
                source.messageId &&
                source.channelId &&
                onOpenConversation ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReturnSource(source.targetId);
                      onContextJump?.(source.targetId);
                      onOpenConversation(source);
                    }}
                  >
                    View conversation
                  </button>
                ) : null}
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    View in Discord<span className={styles.srOnly}> in a new tab</span>
                  </a>
                ) : null}
              </div>
            </header>
            {source.kind === 'recent_member_previews' ? (
              <p className={styles.previewLabel}>
                {detail.userIdentity.displayLabel} · saved message previews
              </p>
            ) : null}
            {source.records.map((record) => (
              <div key={record.id}>
                <CaseEvidenceRecord record={record} />
                {source.kind === 'recent_member_previews' && record.url ? (
                  <a
                    className={styles.previewLink}
                    href={record.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View preview source in Discord
                    <span className={styles.srOnly}> in a new tab</span>
                  </a>
                ) : null}
              </div>
            ))}
          </section>
        ))}
        {!sources.length ? <p className={styles.empty}>No source evidence saved.</p> : null}
      </div>
    </div>
  );
}
