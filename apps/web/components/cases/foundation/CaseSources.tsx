import type { CaseDetail, ReportDetail } from '@drasil/contracts';
import type { Ref } from 'react';
import { ReportEvidence } from '@/components/inbox/foundation/ReportEvidence';
import { Timestamp } from '@/components/workspace/Timestamp';
import { recordLabel } from '../caseRecordLabel';
import styles from './CaseWorkspace.module.css';

function SourceLink({ url }: { readonly url: string | null }) {
  return url ? (
    <a className={styles.sourceLink} href={url} target="_blank" rel="noreferrer">
      View in Discord<span className={styles.srOnly}> in a new tab</span>
    </a>
  ) : null;
}

type SavedRecord = Pick<
  CaseDetail['evidenceItems'][number],
  'id' | 'url' | 'content' | 'createdAt'
> & {
  readonly label: string;
  readonly timeLabel: string;
};

function SavedRecordView({
  record,
  grouped = false,
}: {
  readonly record: SavedRecord;
  readonly grouped?: boolean;
}) {
  const Heading = grouped ? 'h4' : 'h3';
  return (
    <article className={styles.source}>
      <header>
        <Heading>{record.label}</Heading>
        {record.createdAt ? <Timestamp value={record.createdAt} prefix={record.timeLabel} /> : null}
      </header>
      {record.content ? (
        <blockquote>{record.content}</blockquote>
      ) : (
        <p className={styles.muted}>Content not recorded.</p>
      )}
      {grouped ? null : <SourceLink url={record.url} />}
    </article>
  );
}

export function CaseSources({
  detail,
  report,
  evidenceId,
  sectionRef,
}: {
  readonly detail: CaseDetail;
  readonly report?: ReportDetail;
  readonly evidenceId: string;
  readonly sectionRef: Ref<HTMLElement>;
}) {
  const sourceMessages = detail.messageContext.filter((item) => item.isSource);
  const surrounding = detail.messageContext.filter((item) => !item.isSource);
  const reportEvidence =
    report?.evidence.filter((item) => item.kind !== 'candidate_confirmation') ?? [];
  const records: SavedRecord[] = [
    ...detail.evidenceItems.map((item) => ({
      ...item,
      id: `evidence-${item.id}`,
      label: recordLabel(item.kind),
      timeLabel: 'Recorded',
    })),
    ...sourceMessages.map((item) => ({
      id: `source-${item.id}`,
      url: item.url,
      content: item.contentPreview,
      createdAt: item.createdAt,
      label: 'Source message excerpt',
      timeLabel: 'Message time',
    })),
  ];
  const groups = new Map<string, SavedRecord[]>();
  for (const record of records) {
    const key = record.url ?? record.id;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  return (
    <section ref={sectionRef} id={evidenceId} className={styles.section} aria-label="Case evidence">
      <div className={styles.sectionHeading}>
        <h2 tabIndex={-1}>Evidence</h2>
      </div>
      {report ? (
        <div className={styles.submitted}>
          <ReportEvidence items={reportEvidence} />
        </div>
      ) : null}
      {[...groups.entries()].map(([key, group]) =>
        group.length > 1 ? (
          <section
            key={key}
            className={styles.sharedSource}
            aria-label="Records from one source message"
          >
            <header>
              <div>
                <h3>Source message</h3>
                <p className={styles.muted}>{group.length} saved records</p>
              </div>
              <SourceLink url={key} />
            </header>
            {group.map((record) => (
              <SavedRecordView key={record.id} record={record} grouped />
            ))}
          </section>
        ) : (
          group.map((record) => <SavedRecordView key={record.id} record={record} />)
        )
      )}
      {!reportEvidence.length && !detail.evidenceItems.length && !sourceMessages.length ? (
        <p className={styles.muted}>No source evidence saved.</p>
      ) : null}
      {surrounding.length ? (
        <details className={styles.disclosure}>
          <summary>
            Saved surrounding messages <span>{surrounding.length}</span>
          </summary>
          {surrounding.map((item) => (
            <article key={item.id} className={styles.source}>
              <header>
                <h3>Saved message excerpt</h3>
                <Timestamp value={item.createdAt} />
              </header>
              <blockquote>{item.contentPreview}</blockquote>
              <SourceLink url={item.url} />
            </article>
          ))}
        </details>
      ) : null}
    </section>
  );
}
