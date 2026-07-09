'use client';

import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { CaseSummary } from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CaseIdentity } from './CaseIdentity';
import { DiscordExternalLink } from './DiscordExternalLink';
import {
  confidenceStatusClass,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatSurfaceKind,
  formatUtc,
  presenceStatusClass,
  surfaceKindClass,
} from '@/lib/casePresentation';
import {
  buildVisibleHistoryExportText,
  caseHistoryPresenceFilterOptions,
  caseHistorySortOptions,
  getVisibleHistoryCases,
  type CaseHistoryPresenceFilter,
  type CaseHistorySortMode,
} from '@/lib/caseHistoryViewModel';

interface CaseHistoryViewProps {
  readonly cases: readonly CaseSummary[];
  readonly guildId: string;
  readonly guildName: string;
  readonly sessionUsername: string;
  readonly totalResolvedCaseCount: number;
}

function SurfaceLinks({ item }: { readonly item: CaseSummary }) {
  if (item.surfaces.length === 0) {
    return <p className="muted">No Discord surfaces recorded.</p>;
  }

  return (
    <div className="surface-list" aria-label="Discord surfaces">
      {item.surfaces.map((surface) => (
        <DiscordExternalLink
          className={surfaceKindClass(surface.kind)}
          desktopHref={surface.desktopUrl}
          href={surface.url}
          key={`${item.id}-${surface.kind}`}
          label={`${formatSurfaceKind(surface.kind)} for ${item.userIdentity.displayLabel}`}
        >
          {formatSurfaceKind(surface.kind)}
        </DiscordExternalLink>
      ))}
    </div>
  );
}

function ResolvedCaseRow({
  guildId,
  item,
}: {
  readonly guildId: string;
  readonly item: CaseSummary;
}) {
  return (
    <article className="inbox-row">
      <div className="inbox-main">
        <div className="case-card-header">
          <CaseIdentity
            headingLevel={2}
            href={`/admin/guild/${guildId}/cases/${item.id}`}
            identity={item.userIdentity}
          />
          <span className={presenceStatusClass(item.presenceState)}>
            {formatPresenceState(item.presenceState)}
          </span>
        </div>

        <div className="case-meta compact">
          <div>
            <span className="muted">Latest detection</span>
            <strong>{formatDetectionType(item.latestDetectionType)}</strong>
          </div>
          <div>
            <span className="muted">Signal</span>
            <span className={confidenceStatusClass(item.confidence)}>
              {formatConfidence(item.confidence)}
            </span>
          </div>
          <div>
            <span className="muted">Resolved or updated</span>
            <strong>{formatUtc(item.updatedAt)}</strong>
          </div>
          <div>
            <span className="muted">Last moderator action</span>
            <strong>
              {item.lastActionType ? formatDetectionType(item.lastActionType) : 'None recorded'}
            </strong>
          </div>
        </div>

        <SurfaceLinks item={item} />

        <div className="actions">
          <a
            className="button secondary compact-button"
            href={`/admin/guild/${guildId}/cases/${item.id}`}
          >
            Open Detail
          </a>
        </div>
      </div>
    </article>
  );
}

function CaseHistoryControls({
  exportText,
  onPresenceFilterChange,
  onSearchChange,
  onSortChange,
  presenceFilter,
  searchQuery,
  searchInputRef,
  sortMode,
  visibleCount,
}: {
  readonly exportText: string;
  readonly onPresenceFilterChange: (value: CaseHistoryPresenceFilter) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSortChange: (value: CaseHistorySortMode) => void;
  readonly presenceFilter: CaseHistoryPresenceFilter;
  readonly searchQuery: string;
  readonly searchInputRef: Ref<HTMLInputElement>;
  readonly sortMode: CaseHistorySortMode;
  readonly visibleCount: number;
}) {
  return (
    <section className="panel inbox-toolbar" aria-label="History controls">
      <div className="inbox-controls">
        <div className="field">
          <label htmlFor="history-search">Search</label>
          <input
            autoComplete="off"
            id="history-search"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="User, action, source, case"
            ref={searchInputRef}
            type="search"
            value={searchQuery}
          />
        </div>
        <div className="field">
          <label htmlFor="history-presence">Outcome</label>
          <select
            id="history-presence"
            onChange={(event) =>
              onPresenceFilterChange(event.currentTarget.value as CaseHistoryPresenceFilter)
            }
            value={presenceFilter}
          >
            {caseHistoryPresenceFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="history-sort">Sort</label>
          <select
            id="history-sort"
            onChange={(event) => onSortChange(event.currentTarget.value as CaseHistorySortMode)}
            value={sortMode}
          >
            {caseHistorySortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {visibleCount > 0 ? (
        <details className="inline-action export-action">
          <summary className="button secondary compact-button inline-action-summary">
            Export Visible
          </summary>
          <div className="inline-action-panel export-panel">
            <label className="field">
              <span>Visible History Packet</span>
              <textarea
                aria-label="Visible history export"
                readOnly
                rows={Math.min(Math.max(visibleCount + 1, 4), 8)}
                value={exportText}
              />
            </label>
          </div>
        </details>
      ) : null}
    </section>
  );
}

export function CaseHistoryView({
  cases,
  guildId,
  guildName,
  sessionUsername,
  totalResolvedCaseCount,
}: CaseHistoryViewProps) {
  const [presenceFilter, setPresenceFilter] = useState<CaseHistoryPresenceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<CaseHistorySortMode>('newest');
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const hydratedSearchQuery = searchInputRef.current?.value ?? '';
    setSearchQuery((current) => (current === hydratedSearchQuery ? current : hydratedSearchQuery));
  }, []);
  const visibleCases = useMemo(
    () => getVisibleHistoryCases(cases, presenceFilter, searchQuery, sortMode),
    [cases, presenceFilter, searchQuery, sortMode]
  );
  const visibleExportText = useMemo(
    () => buildVisibleHistoryExportText(guildId, visibleCases),
    [guildId, visibleCases]
  );
  const shownCount = visibleCases.length;
  const bannedCount = visibleCases.filter((item) => item.presenceState === 'banned').length;
  const retainedCount = visibleCases.filter((item) => item.presenceState === 'in_server').length;

  return (
    <main className="shell stack">
      <nav className="topbar">
        <a className="brand" href={`/admin/guild/${guildId}/history`}>
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={`/admin/guild/${guildId}/inbox`}>
            Inbox
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Case Queue
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/reports`}>
            Reports
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <h1 className="page-title">{guildName} Case History</h1>
          <p className="lede">
            Inspect resolved cases, outcomes, and Discord provenance without reopening or mutating
            the case state.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Resolved cases</span>
            <strong>{totalResolvedCaseCount}</strong>
          </div>
          <div>
            <span className="muted">Shown</span>
            <strong>{shownCount}</strong>
          </div>
          <div>
            <span className="muted">Banned</span>
            <strong>{bannedCount}</strong>
          </div>
          <div>
            <span className="muted">Still in server</span>
            <strong>{retainedCount}</strong>
          </div>
        </div>
      </section>

      <CaseHistoryControls
        exportText={visibleExportText}
        onPresenceFilterChange={setPresenceFilter}
        onSearchChange={setSearchQuery}
        onSortChange={setSortMode}
        presenceFilter={presenceFilter}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        sortMode={sortMode}
        visibleCount={shownCount}
      />

      {cases.length === 0 ? (
        <section className="panel stack">
          <h2>No resolved cases</h2>
          <p className="muted">Resolved cases will appear here after moderators finish reviews.</p>
        </section>
      ) : visibleCases.length === 0 ? (
        <section className="panel stack">
          <h2>No matching cases</h2>
          <p className="muted">Change the filters or search text to bring cases back into view.</p>
        </section>
      ) : (
        <section className="inbox-list" aria-label="Resolved cases">
          {visibleCases.map((item) => (
            <ResolvedCaseRow guildId={guildId} item={item} key={item.id} />
          ))}
        </section>
      )}
    </main>
  );
}
