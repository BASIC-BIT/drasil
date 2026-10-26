'use client';
import { useState } from 'react';
import { presentApprovalResult } from '@drasil/application/approval-presentation';
import type { ApprovalSummary, PublicActionResult } from '@drasil/application';
export function ConfirmationView(
  props: Omit<ApprovalSummary, 'expiresAt'> & {
    approve: (form: FormData) => Promise<PublicActionResult>;
    cancel: (form: FormData) => Promise<PublicActionResult>;
  }
) {
  const [result, setResult] = useState<PublicActionResult | null>(props.receipt ?? null);
  const [error, setError] = useState(false);
  async function submit(form: FormData, action: typeof props.approve) {
    setError(false);
    try {
      setResult(await action(form));
    } catch {
      setError(true);
    }
  }
  const stateLabels = {
    pending: 'Awaiting approval',
    consumed: 'Previously approved',
    cancelled: 'Confirmation cancelled',
    expired: 'Confirmation expired',
    denied: 'Action denied',
  };
  return (
    <main className="mcp-shell">
      <h1>Confirm action</h1>
      <p>Review the saved action before approving it for the original connection.</p>
      <dl aria-label="Action context" className="mcp-approval-context">
        <dt>Server ID</dt>
        <dd>{props.guildId}</dd>
        <dt>Originating client</dt>
        <dd>{props.clientId}</dd>
        <dt>Connection ID</dt>
        <dd>{props.connectionId}</dd>
      </dl>
      <section aria-label="Saved action summary" className="mcp-approval-summary">
        {props.summary}
      </section>
      {result ? (
        <div role="status">
          {presentApprovalResult(result).map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : (
        <p>{stateLabels[props.state]}</p>
      )}
      {error && (
        <p role="alert">
          The response could not be loaded. Keep this confirmation reference and check the original
          connection before trying again.
        </p>
      )}
      {props.state === 'pending' && !result && (
        <form className="mcp-actions">
          <input type="hidden" name="confirmationId" value={props.confirmationId} />
          <button formAction={(form) => submit(form, props.approve)} className="button">
            Approve
          </button>
          <button formAction={(form) => submit(form, props.cancel)} className="button secondary">
            Cancel
          </button>
        </form>
      )}
    </main>
  );
}
