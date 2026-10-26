import type { EvidenceSourceRecord } from '@/lib/evidenceSources';
import { Timestamp } from '@/components/workspace/Timestamp';
import styles from './CaseEvidenceReader.module.css';

export function CaseEvidenceRecord({ record }: { readonly record: EvidenceSourceRecord }) {
  const body = (
    <>
      <span
        className={styles.mark}
        data-kind={record.origin === 'member_preview' ? 'message' : 'report'}
        aria-hidden="true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          {record.origin === 'member_preview' ? (
            <path d="M5 4h14v12H9l-4 4V4Zm4 4h6m-6 4h4" stroke="currentColor" strokeWidth="1.4" />
          ) : (
            <>
              <circle cx="12" cy="8" r="4" fill="currentColor" />
              <path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z" fill="currentColor" />
            </>
          )}
        </svg>
      </span>
      <div className={styles.messageBody}>
        <header>
          <h4>{record.label}</h4>
          <span>
            {record.origin === 'case_evidence'
              ? 'Saved with case'
              : record.origin === 'report_evidence'
                ? 'Submitted with report'
                : 'Saved member preview'}
          </span>
          <Timestamp value={record.createdAt} prefix="Recorded" />
        </header>
        {record.content !== null ? (
          <blockquote>{record.content}</blockquote>
        ) : (
          <p>Content not recorded.</p>
        )}
        {record.attachment ? (
          <p>
            {record.attachment.name ?? 'Attachment'}
            {record.attachment.contentType ? ` · ${record.attachment.contentType}` : ''}
            {record.attachment.size !== null ? ` · ${record.attachment.size} bytes` : ''}
          </p>
        ) : null}
      </div>
    </>
  );
  return record.attachment?.url ? (
    <a
      className={`${styles.message} ${styles.attachment}`}
      href={record.attachment.url}
      target="_blank"
      rel="noreferrer"
    >
      {body}
      <span className={styles.srOnly}>Open attachment in a new tab</span>
    </a>
  ) : (
    <article className={styles.message}>
      {body}
      {record.attachment ? <p>Attachment link not recorded.</p> : null}
    </article>
  );
}
