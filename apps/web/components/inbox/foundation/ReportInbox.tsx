'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MemberProfile, ReportDetail } from '@drasil/contracts';
import { Foundation, DrasilBrand, type FoundationTheme } from '@/components/workspace/Foundation';
import { ReportQueue } from './ReportQueue';
import { ReportReview } from './ReportReview';
import { MobileWorkspaceMenu, WorkspaceLinks } from '@/components/workspace/WorkspaceNavigation';
import {
  isReportClosed,
  readyReport,
  reportName,
  type ReportActionHandler,
  type ReportReviewState,
  type ReportTriageAction,
} from './reportTriage';
import styles from './ReportInbox.module.css';

interface ReportInboxProps {
  readonly guildName: string;
  readonly guildId: string;
  readonly reports: readonly ReportDetail[];
  readonly memberProfiles?: readonly MemberProfile[];
  readonly onAction: ReportActionHandler;
  readonly theme?: FoundationTheme;
}

export function ReportInbox({
  guildName,
  guildId,
  reports,
  memberProfiles,
  onAction,
  theme,
}: ReportInboxProps) {
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [states, setStates] = useState<Readonly<Record<string, ReportReviewState>>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inboxHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusTarget = useRef<'detail' | 'queue' | null>(null);
  const inFlight = useRef(new Set<string>());
  const selected = reports.find((report) => report.id === selectedId) ?? null;
  const matching = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return reports.filter((report) =>
      [reportName(report), report.summary, report.targetUserId].some((value) =>
        value?.toLocaleLowerCase().includes(term)
      )
    );
  }, [reports, query]);
  const visible = matching.filter(
    (report) => !isReportClosed(states[report.id] ?? readyReport) || report.id === selectedId
  );
  const openReports = reports.filter((report) => !isReportClosed(states[report.id] ?? readyReport));
  const selectedIndex = matching.findIndex((report) => report.id === selectedId);
  const followingReports =
    selectedIndex < 0
      ? matching
      : matching.slice(selectedIndex + 1).concat(matching.slice(0, selectedIndex));
  const next = followingReports.find((report) => !isReportClosed(states[report.id] ?? readyReport));

  const focusQueue = useCallback((): void => {
    const row = selectedId ? document.getElementById(`report-row-${selectedId}`) : null;
    (row ?? inboxHeadingRef.current)?.focus();
  }, [selectedId]);

  useLayoutEffect(() => {
    if (focusTarget.current === 'detail') headingRef.current?.focus();
    if (focusTarget.current === 'queue') focusQueue();
    focusTarget.current = null;
  }, [focusQueue, mobileDetail]);

  const selectReport = (id: string): void => {
    if (window.matchMedia('(max-width: 1099px)').matches) focusTarget.current = 'detail';
    setSelectedId(id);
    setMobileDetail(true);
  };
  const backToQueue = (): void => {
    const closed = selected && isReportClosed(states[selected.id] ?? readyReport);
    if (!mobileDetail && !closed) {
      focusQueue();
      return;
    }
    focusTarget.current = 'queue';
    if (closed) setSelectedId(null);
    setMobileDetail(false);
  };
  const nextReport = (): void => {
    if (next) {
      focusTarget.current = 'detail';
      setSelectedId(next.id);
      setMobileDetail(true);
    } else {
      focusTarget.current = 'queue';
      setSelectedId(null);
      setMobileDetail(false);
    }
  };
  const takeAction = async (report: ReportDetail, action: ReportTriageAction): Promise<void> => {
    if (inFlight.current.has(report.id)) return;
    inFlight.current.add(report.id);
    setStates((previous) => ({ ...previous, [report.id]: { kind: 'submitting', action } }));
    try {
      const result = await onAction(report.id, action);
      setStates((previous) => ({ ...previous, [report.id]: { kind: 'settled', action, result } }));
    } catch {
      setStates((previous) => ({
        ...previous,
        [report.id]: {
          kind: 'settled',
          action,
          result: {
            status: 'failed',
            requestId: null,
            message: 'The report could not be updated. Try again.',
          },
        },
      }));
    } finally {
      inFlight.current.delete(report.id);
    }
  };

  return (
    <Foundation theme={theme}>
      <div className={styles.workspace} id="inbox" data-mobile-detail={mobileDetail}>
        <aside className={styles.sidebar}>
          <DrasilBrand />
          <p className={styles.community}>{guildName}</p>
          <WorkspaceLinks guildId={guildId} onInbox={backToQueue} />
        </aside>
        <main className={styles.main}>
          <div className={styles.mobileBrand}>
            <DrasilBrand />
            <MobileWorkspaceMenu guildId={guildId} guildName={guildName} onInbox={backToQueue} />
          </div>
          <header className={styles.pageHeader}>
            <div>
              <h1 ref={inboxHeadingRef} tabIndex={-1}>
                Inbox
              </h1>
              <p>
                {openReports.length} {openReports.length === 1 ? 'report' : 'reports'} in queue
              </p>
            </div>
            <span>{guildName}</span>
          </header>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className={styles.srOnly}>Search reports</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search members or report summaries"
              />
            </label>
          </div>
          <div className={styles.workbench} data-empty={!selected && visible.length === 0}>
            <ReportQueue
              reports={visible}
              selectedId={selectedId}
              states={states}
              onSelect={selectReport}
              hasSearch={Boolean(query.trim())}
              onClearSearch={() => setQuery('')}
            />
            {selected ? (
              <ReportReview
                key={selected.id}
                report={selected}
                profile={memberProfiles?.find(
                  (profile) =>
                    profile.guildId === selected.guildId && profile.userId === selected.targetUserId
                )}
                state={states[selected.id] ?? readyReport}
                outsideSearch={!matching.some((report) => report.id === selected.id)}
                onAction={(action) => {
                  void takeAction(selected, action);
                }}
                onNext={nextReport}
                onBack={backToQueue}
                hasNext={Boolean(next)}
                headingRef={headingRef}
              />
            ) : visible.length > 0 ? (
              <section className={styles.detailEmpty}>
                <h2>Select a report</h2>
                <p>Choose a report from the queue.</p>
              </section>
            ) : null}
          </div>
        </main>
      </div>
    </Foundation>
  );
}
