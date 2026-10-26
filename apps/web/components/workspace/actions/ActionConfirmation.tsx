'use client';

import { useEffect, useId, useRef, type FormEvent } from 'react';
import { ActionButton } from '../Foundation';
import styles from './Actions.module.css';

export interface ActionConfirmationProps {
  readonly open: boolean;
  readonly targetLabel: string;
  readonly guildId: string;
  readonly actionLabel: string;
  readonly description: string;
  readonly reason: string;
  readonly reasonReadOnly?: boolean;
  readonly reasonRequired: boolean;
  readonly reasonMaxLength?: number;
  readonly blocked: boolean;
  readonly onReasonChange: (reason: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: (formData: FormData) => void;
}
export function ActionConfirmation({
  open,
  targetLabel,
  guildId,
  actionLabel,
  description,
  reason,
  reasonReadOnly = false,
  reasonRequired,
  reasonMaxLength = 500,
  blocked,
  onReasonChange,
  onCancel,
  onConfirm,
}: ActionConfirmationProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  const confirmation = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      if (confirmation.current) confirmation.current.checked = false;
      dialog.current?.showModal();
      cancel.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!blocked) onConfirm(new FormData(event.currentTarget));
  }
  return (
    <dialog
      ref={dialog}
      className={styles.confirmation}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-context ${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={submit}>
        <h2 id={`${id}-title`}>{actionLabel}</h2>
        <p id={`${id}-context`}>
          {targetLabel}
          <br />
          Server ID {guildId}
        </p>
        <p id={`${id}-description`}>{description}</p>
        <label className={styles.field}>
          <span>Reason{reasonRequired ? ' (required)' : ''}</span>
          <textarea
            aria-label="Reason"
            name="reason"
            value={reason}
            readOnly={reasonReadOnly}
            required={reasonRequired}
            maxLength={reasonMaxLength}
            rows={3}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
        <label className={styles.confirm}>
          <input ref={confirmation} type="checkbox" name="confirmAction" required />
          <span>Confirm {actionLabel}</span>
        </label>
        <div className={styles.buttons}>
          <ActionButton ref={cancel} onClick={onCancel}>
            Cancel
          </ActionButton>
          <ActionButton type="submit" disabled={blocked}>
            Confirm {actionLabel}
          </ActionButton>
        </div>
      </form>
    </dialog>
  );
}
