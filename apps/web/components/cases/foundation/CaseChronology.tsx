import type { CaseDetail } from '@drasil/contracts';
import { Timestamp } from '@/components/inbox/foundation/Timestamp';
import { recordLabel } from './caseReview';
import styles from './CaseLayoutStudy.module.css';

type CaseRecord =
  | { readonly kind: 'opened'; readonly value: CaseDetail }
  | { readonly kind: 'evidence'; readonly value: CaseDetail['evidenceItems'][number] }
  | { readonly kind: 'message'; readonly value: CaseDetail['messageContext'][number] }
  | { readonly kind: 'check'; readonly value: CaseDetail['detectionHistory'][number] }
  | { readonly kind: 'outcome'; readonly value: CaseDetail['moderationOutcomes'][number] };

interface DatedRecord {
  readonly id: string;
  readonly at: string | null;
  readonly record: CaseRecord;
}

function RecordContent({
  record,
  source,
}: {
  readonly record: CaseRecord;
  readonly source?: string;
}) {
  switch (record.kind) {
    case 'opened':
      return <h3>Case opened</h3>;
    case 'evidence':
      return (
        <>
          <h3>{recordLabel(record.value.kind)}</h3>
          <p className={styles.origin}>{source ? `${source} · ` : ''}Saved evidence</p>
          <blockquote>{record.value.content ?? 'Content not recorded.'}</blockquote>
          <SourceLink url={record.value.url} />
        </>
      );
    case 'message':
      return (
        <>
          <h3>Source message excerpt</h3>
          <p className={styles.origin}>
            {source ? `${source} · ` : ''}Message time · {record.value.channelId}
          </p>
          <blockquote>{record.value.contentPreview}</blockquote>
          <SourceLink url={record.value.url} />
        </>
      );
    case 'check':
      return (
        <>
          <h3>{recordLabel(record.value.detectionType)}</h3>
          <p className={styles.origin}>
            Drasil check · Check confidence {Math.round(record.value.confidence * 100)}%
          </p>
          <ul>
            {record.value.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </>
      );
    case 'outcome':
      return (
        <>
          <h3>{recordLabel(record.value.outcomeType)}</h3>
          <p className={styles.origin}>
            {recordLabel(record.value.source)}
            {record.value.actorId ? ` · ${record.value.actorId}` : ''}
          </p>
          {record.value.reason ? <p>{record.value.reason}</p> : null}
        </>
      );
  }
}

function SourceLink({ url }: { readonly url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      View in Discord<span className={styles.srOnly}> in a new tab</span>
    </a>
  ) : null;
}

export function CaseChronology({ detail }: { readonly detail: CaseDetail }) {
  const records: DatedRecord[] = [
    { id: 'case-opened', at: detail.createdAt, record: { kind: 'opened', value: detail } },
    ...detail.evidenceItems.map(
      (value): DatedRecord => ({
        id: `evidence-${value.id}`,
        at: value.createdAt,
        record: { kind: 'evidence', value },
      })
    ),
    ...detail.messageContext
      .filter((item) => item.isSource)
      .map(
        (value): DatedRecord => ({
          id: `message-${value.id}`,
          at: value.createdAt,
          record: { kind: 'message', value },
        })
      ),
    ...detail.detectionHistory.map(
      (value): DatedRecord => ({
        id: `check-${value.id}`,
        at: value.detectedAt,
        record: { kind: 'check', value },
      })
    ),
    ...detail.moderationOutcomes.map(
      (value): DatedRecord => ({
        id: `outcome-${value.id}`,
        at: value.occurredAt,
        record: { kind: 'outcome', value },
      })
    ),
  ];
  records.sort(
    (a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity)
  );
  const sourceCounts = new Map<string, number>();
  for (const { record } of records) {
    if ((record.kind === 'evidence' || record.kind === 'message') && record.value.url) {
      sourceCounts.set(record.value.url, (sourceCounts.get(record.value.url) ?? 0) + 1);
    }
  }
  const sharedSources = new Map(
    [...sourceCounts]
      .filter(([, count]) => count > 1)
      .map(([url, count], index) => [url, `Source ${index + 1} · ${count} saved records`])
  );
  const surrounding = detail.messageContext.filter((item) => !item.isSource);
  return (
    <>
      <ol className={styles.ledger} aria-label="Case chronology">
        {records.map(({ id, at, record }) => (
          <li key={id} data-record-kind={record.kind}>
            <div className={styles.eventTime}>
              {at ? <Timestamp value={at} /> : 'Time not recorded'}
            </div>
            <article className={styles.eventContent}>
              <RecordContent
                record={record}
                source={
                  record.kind === 'evidence' || record.kind === 'message'
                    ? sharedSources.get(record.value.url ?? '')
                    : undefined
                }
              />
            </article>
          </li>
        ))}
      </ol>
      {surrounding.length ? (
        <details className={styles.context}>
          <summary>
            Saved surrounding messages <span>{surrounding.length}</span>
          </summary>
          {surrounding.map((item) => (
            <article key={item.id}>
              <h3>Saved message excerpt</h3>
              <Timestamp value={item.createdAt} />
              <blockquote>{item.contentPreview}</blockquote>
              <SourceLink url={item.url} />
            </article>
          ))}
        </details>
      ) : null}
    </>
  );
}
