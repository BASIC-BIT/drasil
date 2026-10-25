import type { ReportEvidenceItem, ReportEvidenceKind } from '@drasil/contracts';
import { Timestamp } from './Timestamp';
import styles from './ReportInbox.module.css';

const labels: Record<ReportEvidenceKind, string> = {
  reporter_text: 'Reporter statement',
  reported_text: 'Reported message',
  screenshot: 'Screenshot',
  message_link: 'Message link',
  followup_answer: 'Reporter response',
  candidate_confirmation: 'Reporter identification',
  admin_note: 'Moderator note',
};

export function ReportEvidence({ items }: { readonly items: readonly ReportEvidenceItem[] }) {
  return (
    <div className={styles.evidenceList}>
      {items.length === 0 ? (
        <p className={styles.muted}>No evidence attached.</p>
      ) : (
        items.map((item) => {
          const contents = (
            <>
              <header>
                <h3>{labels[item.kind]}</h3>
                <Timestamp value={item.createdAt} />
              </header>
              {item.content ? <blockquote>{item.content}</blockquote> : null}
              {item.attachment ? (
                <div className={styles.attachment}>
                  <span aria-hidden="true" className={styles.fileIcon}>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                      <path
                        d="M14 3H6v18h12V7l-4-4ZM14 3v5h4M9 12h6M9 16h6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <strong>{item.attachment.name ?? 'Attachment'}</strong>
                    <p>
                      {[
                        item.attachment.contentType,
                        item.attachment.size === null
                          ? null
                          : `${Math.round(item.attachment.size / 1024)} KB`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {item.attachment.url ? (
                    <span aria-hidden="true" className={styles.attachmentIndicator}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                        <path
                          d="M7 17 17 7M7 7h10v10"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  ) : (
                    <span className={styles.muted}>Preview unavailable</span>
                  )}
                </div>
              ) : null}
            </>
          );
          return (
            <article className={styles.evidence} key={item.id}>
              {item.attachment?.url ? (
                <a
                  className={styles.attachmentItem}
                  href={item.attachment.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {contents}
                  <span className={styles.srOnly}> in a new tab</span>
                </a>
              ) : (
                contents
              )}
              {item.sourceMessageUrl ? (
                <a
                  className={styles.sourceLink}
                  href={item.sourceMessageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View in Discord<span className={styles.srOnly}> in a new tab</span>
                </a>
              ) : null}
            </article>
          );
        })
      )}
    </div>
  );
}
