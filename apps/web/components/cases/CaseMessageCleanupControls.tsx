'use client';
import { InboxActionForm, type InboxStateAction } from '@/components/inbox/InboxActionForm';
export function CaseBanActionControl({
  banActionLabel = 'Ban User',
  durableRequest,
  requestBaseHref,
  standardBanFormAction,
  standardBanStateAction,
}: {
  readonly banActionLabel?: string;
  readonly durableRequest?: Parameters<typeof InboxActionForm>[0]['durableRequest'];
  readonly requestBaseHref: string;
  readonly standardBanFormAction?: (formData: FormData) => Promise<void>;
  readonly standardBanStateAction?: InboxStateAction;
}) {
  return (
    <details className="destructive-action cleanup-ban-action">
      <summary className="button secondary compact-button destructive-summary">
        {banActionLabel}
      </summary>
      <div className="destructive-action-panel cleanup-ban-panel">
        {standardBanStateAction ? (
          <InboxActionForm
            action={standardBanStateAction}
            buttonClassName="button compact-button danger-button"
            buttonLabel={`Queue ${banActionLabel}`}
            durableRequest={durableRequest}
            formClassName="cleanup-standard-ban-form"
            requestBaseHref={requestBaseHref}
          >
            <label className="field destructive-reason">
              <span>Reason</span>
              <textarea name="reason" rows={3} />
            </label>
            <label className="checkbox-field destructive-confirm">
              <input name="confirmAction" type="checkbox" />
              <span>Confirm {banActionLabel}</span>
            </label>
          </InboxActionForm>
        ) : standardBanFormAction ? (
          <form action={standardBanFormAction} className="cleanup-standard-ban-form">
            <label className="field destructive-reason">
              <span>Reason</span>
              <textarea name="reason" rows={3} />
            </label>
            <label className="checkbox-field destructive-confirm">
              <input name="confirmAction" type="checkbox" />
              <span>Confirm {banActionLabel}</span>
            </label>
            <button className="button compact-button danger-button" type="submit">
              Queue {banActionLabel}
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}
