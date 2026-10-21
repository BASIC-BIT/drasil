'use client';
import { useState } from 'react';
import type { ApprovalSummary, PublicActionResult } from '@drasil/application';
export function ConfirmationView(
  props: Pick<ApprovalSummary, 'confirmationId' | 'summary' | 'state'> & {
    approve: (form: FormData) => Promise<PublicActionResult>;
    cancel: (form: FormData) => Promise<PublicActionResult>;
  }
) {
  const [result, setResult] = useState<PublicActionResult | null>(null);
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
      <section aria-label="Saved action summary" className="mcp-approval-summary">
        {props.summary}
      </section>
      {result ? (
        <div role="status">
          <p>{result.code === 'cancelled' ? 'Confirmation cancelled' : `Action ${result.state}`}</p>
          {result.executionId && (
            <p>
              Execution: <code>{result.executionId}</code>
            </p>
          )}
          {result.state === 'uncertain' && (
            <p>
              The outcome is uncertain. Keep this execution reference and check its status before
              starting another action.
            </p>
          )}
          {result.code && result.code !== 'cancelled' && <p>{result.code}</p>}
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
