'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  ModerationInboxAction,
  ModerationInboxItem,
  ModerationInboxItemKind,
} from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  CaseActionControls,
  isExecutableCaseAction,
  type QueueInboxCaseAction,
  type QueueCaseAction,
  type WebCaseAction,
} from '@/components/cases/CaseActionControls';
import { InboxActionForm, type InboxStateAction } from './InboxActionForm';
import { InboxActionRequestPollingProvider } from './InboxActionRequestPoller';
import { formatDetectionType, formatUtc, freshnessStatusClass } from '@/lib/casePresentation';
import type { InboxActionState } from '@/lib/inboxActionState';
import { findInboxActionRequest } from '@/lib/inboxActionReceipts';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import {
  buildModerationInboxExportText,
  getModerationInboxAttentionQueueItemIds,
  getModerationInboxVisibleItems,
  isModerationInboxSavedViewActive,
  isModerationInboxAttentionKind,
  moderationInboxSavedViews,
  type ModerationInboxFreshnessFilter,
  type ModerationInboxKindFilter,
  type ModerationInboxSavedView,
  type ModerationInboxSortMode,
  type ModerationInboxViewControls,
} from '@/lib/moderationInboxViewModel';

interface ModerationInboxViewProps {
  readonly acknowledgeQueueItemAction: AcknowledgeQueueItemAction;
  readonly acknowledgeQueueItemsAction: AcknowledgeQueueItemsAction;
  readonly canOpenReportCases: boolean;
  readonly canQueueCaseActions: boolean;
  readonly closeReportAction: CloseReportAction;
  readonly guildId: string;
  readonly guildName: string;
  readonly sessionUsername: string;
  readonly items: readonly ModerationInboxItem[];
  readonly openReportCaseAction: OpenReportCaseAction;
  readonly queueCaseAction: QueueCaseAction;
  readonly queueInboxCaseAction: QueueInboxCaseAction;
  readonly queueObservedAlertAction: QueueObservedAlertAction;
  readonly recentActionRequests: readonly ModerationActionRequestSummary[];
  readonly pollActionRequests: boolean;
}

type AcknowledgeQueueItemAction = (
  guildId: string,
  queueItemId: string,
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;
type AcknowledgeQueueItemsAction = (
  guildId: string,
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;
type ReportClosureAction = Extract<
  ModerationInboxAction,
  'mark_actioned' | 'dismiss_no_action' | 'mark_false_positive'
>;
type CloseReportAction = (
  guildId: string,
  reportId: string,
  action: ReportClosureAction,
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;
type OpenReportCaseAction = (
  guildId: string,
  reportId: string,
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;
type QueueObservedAlertAction = (
  guildId: string,
  targetUserId: string,
  detectionEventId: string,
  action: ModerationInboxAction,
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;

interface ControlOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

const kindLabels: Record<ModerationInboxItemKind, string> = {
  case: 'Case',
  observed_alert: 'Observed Alert',
  pending_screening: 'Pending Screening',
  report_attention: 'Report Reply',
  submitted_report: 'Report',
  support_attention: 'Support Reply',
};

const kindFilterOptions: readonly ControlOption<ModerationInboxKindFilter>[] = [
  { value: 'all', label: 'All Types' },
  { value: 'case', label: kindLabels.case },
  { value: 'submitted_report', label: kindLabels.submitted_report },
  { value: 'observed_alert', label: kindLabels.observed_alert },
  { value: 'support_attention', label: kindLabels.support_attention },
  { value: 'report_attention', label: kindLabels.report_attention },
  { value: 'pending_screening', label: kindLabels.pending_screening },
];

const freshnessFilterOptions: readonly ControlOption<ModerationInboxFreshnessFilter>[] = [
  { value: 'all', label: 'All Freshness' },
  { value: 'stale', label: 'Stale' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'attention', label: 'Attention' },
];

const sortOptions: readonly ControlOption<ModerationInboxSortMode>[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'stale', label: 'Most Stale' },
  { value: 'newest', label: 'Newest Update' },
  { value: 'oldest', label: 'Oldest Update' },
];

const actionLabels: Record<ModerationInboxAction, string> = {
  acknowledge: 'Acknowledge',
  ban_by_id: 'Ban by ID',
  ban_user: 'Ban User',
  close_no_action: 'Close No Action',
  create_thread: 'Create Thread',
  dismiss_no_action: 'Dismiss No Action',
  kick_user: 'Kick User',
  mark_actioned: 'Mark Actioned',
  mark_false_positive: 'False Positive',
  open_case: 'Open Case',
  open_discord: 'Open Discord',
  repair_thread: 'Repair Thread',
  reopen_case: 'Reopen Case',
  refresh_notification: 'Refresh Notification',
  sync_existing_ban: 'Sync Existing Ban',
  verify_user: 'Verify User',
  view_case: 'View Case',
  view_history: 'View History',
  view_report: 'View Report',
};

const reportClosureActionSet = new Set<ModerationInboxAction>([
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
]);

function isReportClosureAction(action: ModerationInboxAction): action is ReportClosureAction {
  return reportClosureActionSet.has(action);
}

function itemKindClass(kind: ModerationInboxItemKind): string {
  switch (kind) {
    case 'case':
      return 'status warning';
    case 'observed_alert':
      return 'status confidence-medium';
    case 'submitted_report':
      return 'status info';
    case 'report_attention':
    case 'support_attention':
      return 'status stale';
    case 'pending_screening':
      return 'status neutral';
  }
}

function countKind(items: readonly ModerationInboxItem[], kind: ModerationInboxItemKind): number {
  return items.filter((item) => item.kind === kind).length;
}

function InboxControls({
  acknowledgeQueueItemsAction,
  controls,
  guildId,
  onFreshnessChange,
  onKindChange,
  onClearSelection,
  onSearchChange,
  onSavedViewSelect,
  onSelectVisible,
  onSortChange,
  selectedAttentionQueueItemIds,
  selectedCount,
  selectedExportText,
  visibleAttentionQueueItemIds,
  visibleCount,
  visibleExportText,
}: {
  readonly acknowledgeQueueItemsAction: AcknowledgeQueueItemsAction;
  readonly controls: ModerationInboxViewControls;
  readonly guildId: string;
  readonly onFreshnessChange: (value: ModerationInboxFreshnessFilter) => void;
  readonly onKindChange: (value: ModerationInboxKindFilter) => void;
  readonly onClearSelection: () => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSavedViewSelect: (savedView: ModerationInboxSavedView) => void;
  readonly onSelectVisible: () => void;
  readonly onSortChange: (value: ModerationInboxSortMode) => void;
  readonly selectedAttentionQueueItemIds: readonly string[];
  readonly selectedCount: number;
  readonly selectedExportText: string;
  readonly visibleAttentionQueueItemIds: readonly string[];
  readonly visibleCount: number;
  readonly visibleExportText: string;
}) {
  const hasSelection = selectedCount > 0;
  const exportItemsLabel = hasSelection ? 'Selected Review Packet' : 'Visible Review Packet';
  const exportItemsText = hasSelection ? selectedExportText : visibleExportText;
  const exportItemsCount = hasSelection ? selectedCount : visibleCount;
  const acknowledgeQueueItemIds = hasSelection
    ? selectedAttentionQueueItemIds
    : visibleAttentionQueueItemIds;
  const acknowledgeButtonLabel = hasSelection
    ? 'Acknowledge Selected Replies'
    : 'Acknowledge Visible Replies';

  return (
    <section className="panel inbox-toolbar" aria-label="Inbox controls">
      <div className="saved-view-list" aria-label="Saved inbox views">
        {moderationInboxSavedViews.map((savedView) => {
          const active = isModerationInboxSavedViewActive(controls, savedView);
          return (
            <button
              aria-pressed={active}
              className="button secondary compact-button saved-view-button"
              key={savedView.id}
              onClick={() => onSavedViewSelect(savedView)}
              type="button"
            >
              {savedView.label}
            </button>
          );
        })}
      </div>
      {visibleAttentionQueueItemIds.length > 0 || visibleCount > 0 ? (
        <div className="bulk-action-row">
          <button
            className="button secondary compact-button"
            onClick={onSelectVisible}
            type="button"
          >
            Select Visible
          </button>
          {hasSelection ? (
            <button
              className="button secondary compact-button"
              onClick={onClearSelection}
              type="button"
            >
              Clear Selection
            </button>
          ) : null}
          <span className="selection-summary">
            {hasSelection ? `${selectedCount} selected` : `${visibleCount} visible`}
          </span>
          {acknowledgeQueueItemIds.length > 0 ? (
            <InboxActionForm
              action={acknowledgeQueueItemsAction.bind(null, guildId) as InboxStateAction}
              buttonLabel={acknowledgeButtonLabel}
              formClassName="bulk-action-form"
              key={acknowledgeQueueItemIds.join(':')}
            >
              {acknowledgeQueueItemIds.map((queueItemId) => (
                <input key={queueItemId} name="queueItemId" type="hidden" value={queueItemId} />
              ))}
            </InboxActionForm>
          ) : null}
          {exportItemsCount > 0 ? (
            <details className="inline-action export-action">
              <summary className="button secondary compact-button inline-action-summary">
                {hasSelection ? 'Export Selected' : 'Export Visible'}
              </summary>
              <div className="inline-action-panel export-panel">
                <label className="field">
                  <span>{exportItemsLabel}</span>
                  <textarea
                    aria-label={hasSelection ? 'Selected inbox export' : 'Visible inbox export'}
                    readOnly
                    rows={Math.min(Math.max(exportItemsCount + 1, 4), 8)}
                    value={exportItemsText}
                  />
                </label>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="inbox-controls">
        <div className="field">
          <label htmlFor="inbox-search">Search</label>
          <input
            autoComplete="off"
            id="inbox-search"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="User, status, evidence, link"
            type="search"
            value={controls.searchQuery}
          />
        </div>
        <div className="field">
          <label htmlFor="inbox-kind">Type</label>
          <select
            id="inbox-kind"
            onChange={(event) =>
              onKindChange(event.currentTarget.value as ModerationInboxKindFilter)
            }
            value={controls.kind}
          >
            {kindFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inbox-freshness">Freshness</label>
          <select
            id="inbox-freshness"
            onChange={(event) =>
              onFreshnessChange(event.currentTarget.value as ModerationInboxFreshnessFilter)
            }
            value={controls.freshness}
          >
            {freshnessFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inbox-sort">Sort</label>
          <select
            id="inbox-sort"
            onChange={(event) => onSortChange(event.currentTarget.value as ModerationInboxSortMode)}
            value={controls.sortMode}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted">{visibleCount} visible</p>
    </section>
  );
}

function InboxLinks({ item }: { readonly item: ModerationInboxItem }) {
  if (item.links.length === 0 && !item.detailHref) {
    return <span className="muted">No linked surfaces recorded.</span>;
  }

  return (
    <div className="surface-list" aria-label={`Links for ${item.title}`}>
      {item.detailHref ? (
        <a className="surface-link admin-surface" href={item.detailHref}>
          Open Detail
        </a>
      ) : null}
      {item.links.map((link) => {
        const external = link.url.startsWith('http');
        return (
          <a
            className="surface-link"
            href={link.url}
            key={`${item.id}-${link.label}-${link.url}`}
            rel={external ? 'noreferrer' : undefined}
            target={external ? '_blank' : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </div>
  );
}

function InboxActions({
  acknowledgeQueueItemAction,
  canOpenReportCases,
  canQueueCaseActions,
  closeReportAction,
  item,
  openReportCaseAction,
  queueCaseAction,
  queueInboxCaseAction,
  queueObservedAlertAction,
  recentActionRequests,
}: {
  readonly acknowledgeQueueItemAction: AcknowledgeQueueItemAction;
  readonly canOpenReportCases: boolean;
  readonly canQueueCaseActions: boolean;
  readonly closeReportAction: CloseReportAction;
  readonly item: ModerationInboxItem;
  readonly openReportCaseAction: OpenReportCaseAction;
  readonly queueCaseAction: QueueCaseAction;
  readonly queueInboxCaseAction: QueueInboxCaseAction;
  readonly queueObservedAlertAction: QueueObservedAlertAction;
  readonly recentActionRequests: readonly ModerationActionRequestSummary[];
}) {
  if (item.allowedActions.length === 0) {
    return <span className="muted">No actions available.</span>;
  }

  const caseActions =
    item.kind === 'case' ? item.allowedActions.filter(isExecutableCaseAction) : [];
  const actionRequestsByAction = Object.fromEntries(
    caseActions.map((action) => [
      action,
      findInboxActionRequest(recentActionRequests, item, action),
    ])
  ) as Partial<Record<WebCaseAction, ModerationActionRequestSummary | null>>;

  return (
    <div className="pill-list action-form-list" aria-label={`Actions for ${item.title}`}>
      {item.allowedActions.map((action) => {
        if (item.kind === 'case' && isExecutableCaseAction(action)) {
          return null;
        }

        if (action === 'acknowledge') {
          if (!item.queueItemId) {
            return (
              <button
                className="button secondary compact-button"
                disabled
                key={`${item.id}-${action}`}
                title="No queue item is available to acknowledge"
                type="button"
              >
                {actionLabels[action]}
              </button>
            );
          }
          return (
            <InboxActionForm
              action={
                acknowledgeQueueItemAction.bind(
                  null,
                  item.guildId,
                  item.queueItemId
                ) as InboxStateAction
              }
              buttonLabel={actionLabels[action]}
              key={`${item.id}-${action}`}
            />
          );
        }

        if (action === 'view_case' || action === 'view_report') {
          return item.detailHref ? (
            <a
              className="button secondary compact-button"
              href={item.detailHref}
              key={`${item.id}-${action}`}
            >
              {actionLabels[action]}
            </a>
          ) : (
            <button
              className="button secondary compact-button"
              disabled
              key={`${item.id}-${action}`}
              title="No detail page is available"
              type="button"
            >
              {actionLabels[action]}
            </button>
          );
        }

        if (action === 'view_history') {
          return (
            <a
              className="button secondary compact-button"
              href={`/admin/guild/${item.guildId}/members/${item.subject.userId}`}
              key={`${item.id}-${action}`}
            >
              {actionLabels[action]}
            </a>
          );
        }

        if (action === 'open_discord') {
          const discordLink = item.links.find((link) => link.url.startsWith('http'));
          return discordLink ? (
            <a
              className="button secondary compact-button"
              href={discordLink.url}
              key={`${item.id}-${action}`}
              rel="noreferrer"
              target="_blank"
            >
              {actionLabels[action]}
            </a>
          ) : (
            <button
              className="button secondary compact-button"
              disabled
              key={`${item.id}-${action}`}
              title="No Discord surface is available"
              type="button"
            >
              {actionLabels[action]}
            </button>
          );
        }

        if (item.kind === 'submitted_report' && action === 'open_case') {
          return canOpenReportCases ? (
            <InboxActionForm
              action={
                openReportCaseAction.bind(null, item.guildId, item.sourceId) as InboxStateAction
              }
              buttonLabel={actionLabels[action]}
              durableRequest={findInboxActionRequest(recentActionRequests, item, action)}
              key={`${item.id}-${action}`}
              requestBaseHref={`/admin/guild/${item.guildId}/operations`}
            />
          ) : (
            <button
              className="button secondary compact-button"
              disabled
              key={`${item.id}-${action}`}
              title="Requires the bot-side case opener"
              type="button"
            >
              {actionLabels[action]}
            </button>
          );
        }

        if (item.kind === 'submitted_report' && isReportClosureAction(action)) {
          return (
            <InboxActionForm
              action={
                closeReportAction.bind(
                  null,
                  item.guildId,
                  item.sourceId,
                  action
                ) as InboxStateAction
              }
              buttonLabel={actionLabels[action]}
              key={`${item.id}-${action}`}
            />
          );
        }

        if (item.kind === 'observed_alert' && (action === 'kick_user' || action === 'ban_user')) {
          return (
            <details className="destructive-action" key={`${item.id}-${action}`}>
              <summary className="button secondary compact-button destructive-summary">
                {actionLabels[action]}
              </summary>
              <InboxActionForm
                action={
                  queueObservedAlertAction.bind(
                    null,
                    item.guildId,
                    item.subject.userId,
                    item.sourceId,
                    action
                  ) as InboxStateAction
                }
                buttonClassName="button compact-button danger-button"
                buttonLabel={`Queue ${actionLabels[action]}`}
                durableRequest={findInboxActionRequest(recentActionRequests, item, action)}
                formClassName="destructive-action-panel"
                requestBaseHref={`/admin/guild/${item.guildId}/operations`}
              >
                <label className="field destructive-reason">
                  <span>Reason</span>
                  <textarea name="reason" rows={3} />
                </label>
                <label className="checkbox-field destructive-confirm">
                  <input name="confirmAction" type="checkbox" />
                  <span>Confirm {actionLabels[action]}</span>
                </label>
              </InboxActionForm>
            </details>
          );
        }

        if (
          item.kind === 'observed_alert' &&
          (action === 'open_case' ||
            action === 'dismiss_no_action' ||
            action === 'mark_false_positive')
        ) {
          return (
            <InboxActionForm
              action={
                queueObservedAlertAction.bind(
                  null,
                  item.guildId,
                  item.subject.userId,
                  item.sourceId,
                  action
                ) as InboxStateAction
              }
              buttonLabel={actionLabels[action]}
              durableRequest={findInboxActionRequest(recentActionRequests, item, action)}
              key={`${item.id}-${action}`}
              requestBaseHref={`/admin/guild/${item.guildId}/operations`}
            />
          );
        }

        return (
          <button
            className="button secondary compact-button"
            disabled
            key={`${item.id}-${action}`}
            title="This action is not available from the inbox"
            type="button"
          >
            {actionLabels[action]}
          </button>
        );
      })}
      {caseActions.length > 0 ? (
        <CaseActionControls
          actions={caseActions}
          actionRequestsByAction={actionRequestsByAction}
          canQueueCaseActions={canQueueCaseActions}
          caseId={item.sourceId}
          guildId={item.guildId}
          queueCaseAction={queueCaseAction}
          queueInboxCaseAction={queueInboxCaseAction}
        />
      ) : null}
    </div>
  );
}

function InboxRow({
  checked,
  item,
  onSelect,
  onSelectionToggle,
  selected,
}: {
  readonly checked: boolean;
  readonly item: ModerationInboxItem;
  readonly onSelect: () => void;
  readonly onSelectionToggle: () => void;
  readonly selected: boolean;
}) {
  return (
    <article
      className={`inbox-row selectable-inbox-row${selected ? ' selected' : ''}${
        checked ? ' checked' : ''
      }`}
    >
      <div className="inbox-row-select">
        <input
          aria-label={`Select ${item.title}`}
          checked={checked}
          onChange={onSelectionToggle}
          type="checkbox"
        />
      </div>
      <div className="inbox-main">
        <div className="inbox-row-heading">
          <span className={itemKindClass(item.kind)}>{kindLabels[item.kind]}</span>
          <h2>
            <button
              aria-pressed={selected}
              className="inbox-title-button"
              onClick={onSelect}
              type="button"
            >
              {item.title}
            </button>
          </h2>
          <span className={freshnessStatusClass(item.stale)}>
            {item.stale ? `${item.staleHours}h stale` : 'Fresh'}
          </span>
        </div>
        <div className="inbox-subject">
          <strong>{item.subject.displayLabel}</strong>
          <span className="muted">{item.subject.userId}</span>
          {item.subject.secondaryLabel ? (
            <span className="muted">{item.subject.secondaryLabel}</span>
          ) : null}
        </div>
        {item.summary ? <p>{item.summary}</p> : <p className="muted">No summary recorded.</p>}
        <InboxLinks item={item} />
      </div>
    </article>
  );
}

function DetailMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InboxDetailPanel({
  acknowledgeQueueItemAction,
  canOpenReportCases,
  canQueueCaseActions,
  closeReportAction,
  item,
  openReportCaseAction,
  queueCaseAction,
  queueInboxCaseAction,
  queueObservedAlertAction,
  recentActionRequests,
}: {
  readonly acknowledgeQueueItemAction: AcknowledgeQueueItemAction;
  readonly canOpenReportCases: boolean;
  readonly canQueueCaseActions: boolean;
  readonly closeReportAction: CloseReportAction;
  readonly item: ModerationInboxItem | null;
  readonly openReportCaseAction: OpenReportCaseAction;
  readonly queueCaseAction: QueueCaseAction;
  readonly queueInboxCaseAction: QueueInboxCaseAction;
  readonly queueObservedAlertAction: QueueObservedAlertAction;
  readonly recentActionRequests: readonly ModerationActionRequestSummary[];
}) {
  if (!item) {
    return (
      <aside className="inbox-detail" aria-label="Selected inbox item">
        <h2>No matching inbox items</h2>
        <p className="muted">Change the filters or search text to bring items back into view.</p>
      </aside>
    );
  }

  const attentionLabel = isModerationInboxAttentionKind(item.kind)
    ? 'Needs Attention'
    : 'Queue Item';

  return (
    <aside className="inbox-detail" aria-label="Selected inbox item" aria-live="polite">
      <div className="inbox-detail-header">
        <span className={itemKindClass(item.kind)}>{kindLabels[item.kind]}</span>
        <h2>{item.title}</h2>
        <span className={freshnessStatusClass(item.stale)}>
          {item.stale ? `${item.staleHours}h stale` : 'Fresh'}
        </span>
      </div>
      <div className="inbox-subject">
        <strong>{item.subject.displayLabel}</strong>
        <span className="muted">{item.subject.userId}</span>
        {item.subject.secondaryLabel ? (
          <span className="muted">{item.subject.secondaryLabel}</span>
        ) : null}
      </div>
      {item.summary ? <p>{item.summary}</p> : <p className="muted">No summary recorded.</p>}

      <div className="inbox-detail-grid">
        <DetailMetric label="Status" value={formatDetectionType(item.statusLabel)} />
        <DetailMetric label="Signal" value={item.signalLabel ?? 'No signal'} />
        <DetailMetric label="Updated" value={formatUtc(item.updatedAt)} />
        <DetailMetric label="Created" value={formatUtc(item.createdAt)} />
        <DetailMetric label="Source" value={item.sourceId} />
        <DetailMetric label="Queue" value={item.queueItemId ? attentionLabel : 'No queue mirror'} />
      </div>

      <div className="inbox-detail-section">
        <h3>Links</h3>
        <InboxLinks item={item} />
      </div>
      <div className="inbox-detail-section">
        <h3>Actions</h3>
        <InboxActions
          acknowledgeQueueItemAction={acknowledgeQueueItemAction}
          canOpenReportCases={canOpenReportCases}
          canQueueCaseActions={canQueueCaseActions}
          closeReportAction={closeReportAction}
          item={item}
          openReportCaseAction={openReportCaseAction}
          queueCaseAction={queueCaseAction}
          queueInboxCaseAction={queueInboxCaseAction}
          queueObservedAlertAction={queueObservedAlertAction}
          recentActionRequests={recentActionRequests}
        />
      </div>
    </aside>
  );
}

export function ModerationInboxView({
  acknowledgeQueueItemAction,
  acknowledgeQueueItemsAction,
  canOpenReportCases,
  canQueueCaseActions,
  closeReportAction,
  guildId,
  guildName,
  sessionUsername,
  items,
  openReportCaseAction,
  pollActionRequests,
  queueCaseAction,
  queueInboxCaseAction,
  queueObservedAlertAction,
  recentActionRequests,
}: ModerationInboxViewProps) {
  const [kind, setKind] = useState<ModerationInboxKindFilter>('all');
  const [freshness, setFreshness] = useState<ModerationInboxFreshnessFilter>('all');
  const [sortMode, setSortMode] = useState<ModerationInboxSortMode>('priority');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(items[0]?.id ?? null);
  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<string>>(new Set());
  const setSavedView = (savedView: ModerationInboxSavedView) => {
    setKind(savedView.controls.kind);
    setFreshness(savedView.controls.freshness);
    setSortMode(savedView.controls.sortMode);
    setSearchQuery(savedView.controls.searchQuery);
  };

  const controls = useMemo(
    () => ({ kind, freshness, sortMode, searchQuery }),
    [freshness, kind, searchQuery, sortMode]
  );
  const visibleItems = useMemo(
    () => getModerationInboxVisibleItems(items, controls),
    [controls, items]
  );

  useEffect(() => {
    if (visibleItems.length === 0) {
      setSelectedItemId(null);
      setSelectedItemIds(new Set());
      return;
    }

    if (!selectedItemId || !visibleItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(visibleItems[0].id);
    }

    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    setSelectedItemIds((previous) => {
      const next = new Set([...previous].filter((itemId) => visibleItemIds.has(itemId)));
      return next.size === previous.size ? previous : next;
    });
  }, [selectedItemId, visibleItems]);

  const selectedItem =
    visibleItems.find((item) => item.id === selectedItemId) ?? visibleItems[0] ?? null;
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedItemIds.has(item.id)),
    [selectedItemIds, visibleItems]
  );
  const selectedAttentionQueueItemIds = getModerationInboxAttentionQueueItemIds(selectedItems);
  const visibleAttentionQueueItemIds = getModerationInboxAttentionQueueItemIds(visibleItems);
  const visibleExportText = useMemo(
    () => buildModerationInboxExportText(visibleItems),
    [visibleItems]
  );
  const selectedExportText = useMemo(
    () => buildModerationInboxExportText(selectedItems),
    [selectedItems]
  );
  const toggleSelectedItem = (itemId: string) => {
    setSelectedItemIds((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };
  const selectVisibleItems = () => {
    setSelectedItemIds(new Set(visibleItems.map((item) => item.id)));
  };
  const clearSelection = () => setSelectedItemIds(new Set());
  const staleCount = items.filter((item) => item.stale).length;
  const attentionCount = items.filter((item) => isModerationInboxAttentionKind(item.kind)).length;

  const content = (
    <main className="shell stack">
      <nav className="topbar">
        <a className="brand" href="/admin">
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Cases
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/reports`}>
            Reports
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/history`}>
            History
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <a className="button secondary" href="/admin">
            All Servers
          </a>
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <h1 className="page-title">{guildName} Moderation Inbox</h1>
          <p className="lede">
            Review cases, reports, observed alerts, and queue attention from one durable web
            surface.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Inbox items</span>
            <strong>{items.length}</strong>
          </div>
          <div>
            <span className="muted">Visible</span>
            <strong>{visibleItems.length}</strong>
          </div>
          <div>
            <span className="muted">Stale</span>
            <strong>{staleCount}</strong>
          </div>
          <div>
            <span className="muted">Cases</span>
            <strong>{countKind(items, 'case')}</strong>
          </div>
          <div>
            <span className="muted">Reports</span>
            <strong>{countKind(items, 'submitted_report')}</strong>
          </div>
          <div>
            <span className="muted">Observed</span>
            <strong>{countKind(items, 'observed_alert')}</strong>
          </div>
          <div>
            <span className="muted">Attention</span>
            <strong>{attentionCount}</strong>
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <section className="panel stack">
          <h2>No active inbox items</h2>
          <p className="muted">
            Drasil has no pending cases, submitted reports, observed alerts, or queue attention
            items for this server.
          </p>
        </section>
      ) : (
        <>
          <InboxControls
            acknowledgeQueueItemsAction={acknowledgeQueueItemsAction}
            controls={controls}
            guildId={guildId}
            onFreshnessChange={setFreshness}
            onKindChange={setKind}
            onClearSelection={clearSelection}
            onSearchChange={setSearchQuery}
            onSavedViewSelect={setSavedView}
            onSelectVisible={selectVisibleItems}
            onSortChange={setSortMode}
            selectedAttentionQueueItemIds={selectedAttentionQueueItemIds}
            selectedCount={selectedItems.length}
            selectedExportText={selectedExportText}
            visibleAttentionQueueItemIds={visibleAttentionQueueItemIds}
            visibleCount={visibleItems.length}
            visibleExportText={visibleExportText}
          />
          <section className="inbox-workbench" aria-label="Moderation inbox workbench">
            <div className="inbox-list" aria-label="Moderation inbox results">
              {visibleItems.length === 0 ? (
                <div className="inbox-empty-result">
                  <h2>No matching inbox items</h2>
                  <p className="muted">No queue item matched the current controls.</p>
                </div>
              ) : (
                visibleItems.map((item) => (
                  <InboxRow
                    checked={selectedItemIds.has(item.id)}
                    item={item}
                    key={item.id}
                    onSelect={() => setSelectedItemId(item.id)}
                    onSelectionToggle={() => toggleSelectedItem(item.id)}
                    selected={item.id === selectedItem?.id}
                  />
                ))
              )}
            </div>
            <InboxDetailPanel
              acknowledgeQueueItemAction={acknowledgeQueueItemAction}
              canOpenReportCases={canOpenReportCases}
              canQueueCaseActions={canQueueCaseActions}
              closeReportAction={closeReportAction}
              item={selectedItem}
              openReportCaseAction={openReportCaseAction}
              queueCaseAction={queueCaseAction}
              queueInboxCaseAction={queueInboxCaseAction}
              queueObservedAlertAction={queueObservedAlertAction}
              recentActionRequests={recentActionRequests}
            />
          </section>
        </>
      )}
    </main>
  );

  return (
    <InboxActionRequestPollingProvider
      enabled={pollActionRequests}
      serverRequests={recentActionRequests}
    >
      {content}
    </InboxActionRequestPollingProvider>
  );
}
