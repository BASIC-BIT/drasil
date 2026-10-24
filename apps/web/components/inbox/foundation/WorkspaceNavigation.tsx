'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './ReportInbox.module.css';

const primaryDestinations = [
  { label: 'Cases', path: 'cases' },
  { label: 'Reports', path: 'reports' },
  { label: 'History', path: 'history' },
];
const secondaryDestinations = [
  { label: 'Setup', path: 'setup' },
  { label: 'Operations', path: 'operations' },
];

interface WorkspaceLinksProps {
  readonly guildId: string;
  readonly onInbox?: () => void;
  readonly currentPage?: 'inbox' | 'cases';
  readonly onNavigate?: () => void;
}

export function WorkspaceLinks({
  guildId,
  onInbox,
  onNavigate,
  currentPage = 'inbox',
}: WorkspaceLinksProps) {
  return (
    <nav className={styles.workspaceLinks} aria-label="Workspace">
      <a
        href={onInbox ? '#inbox' : `/admin/guild/${guildId}/inbox`}
        aria-current={currentPage === 'inbox' ? 'page' : undefined}
        onClick={(event) => {
          onNavigate?.();
          if (onInbox) {
            event.preventDefault();
            onInbox();
          }
        }}
      >
        Inbox
      </a>
      {primaryDestinations.map(({ label, path }) => (
        <a
          key={path}
          href={`/admin/guild/${guildId}/${path}`}
          aria-current={currentPage === path ? 'page' : undefined}
          onClick={onNavigate}
        >
          {label}
        </a>
      ))}
      <hr />
      {secondaryDestinations.map(({ label, path }) => (
        <a key={path} href={`/admin/guild/${guildId}/${path}`} onClick={onNavigate}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function MobileWorkspaceMenu({
  guildId,
  guildName,
  onInbox,
  currentPage,
}: WorkspaceLinksProps & {
  readonly guildName: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const resize = (): void => {
      if (window.matchMedia('(min-width: 700px)').matches) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  return (
    <div ref={container} className={styles.mobileMenu}>
      <button
        ref={trigger}
        type="button"
        aria-label={`${guildName} workspace menu`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((previous) => !previous)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span>{guildName}</span>
      </button>
      <div id={id} hidden={!open} className={styles.mobileMenuPanel}>
        <WorkspaceLinks
          guildId={guildId}
          onInbox={onInbox}
          currentPage={currentPage}
          onNavigate={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
