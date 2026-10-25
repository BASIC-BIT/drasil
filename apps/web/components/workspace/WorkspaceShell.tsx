'use client';

import { useId, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AccountControl } from '@/components/AccountControl';
import { DrasilBrand, Foundation } from './Foundation';
import { MobileWorkspaceMenu, WorkspaceLinks } from './WorkspaceNavigation';
import styles from './WorkspaceShell.module.css';

export interface WorkspaceShellProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly sessionUsername: string;
  readonly currentPage: 'inbox' | 'cases' | 'history' | 'setup' | 'operations';
  readonly children: ReactNode;
}

export function WorkspaceShell({
  guildId,
  guildName,
  sessionUsername,
  currentPage,
  children,
}: WorkspaceShellProps) {
  const id = useId();
  const account = (
    <>
      <AccountControl username={sessionUsername} />
      <a href="/admin">Switch server</a>
      <ThemeToggle />
    </>
  );
  return (
    <Foundation>
      <a className={styles.skip} href={`#${id}`}>
        Skip to workspace
      </a>
      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="Server and account">
          <DrasilBrand href={`/admin/guild/${guildId}/inbox`} />
          <p className={styles.community}>{guildName}</p>
          <WorkspaceLinks guildId={guildId} currentPage={currentPage} />
          <div className={styles.account}>{account}</div>
        </aside>
        <div className={styles.content}>
          <div className={styles.mobileBrand}>
            <DrasilBrand href={`/admin/guild/${guildId}/inbox`} />
            <MobileWorkspaceMenu
              guildId={guildId}
              guildName={guildName}
              currentPage={currentPage}
            />
          </div>
          <main id={id} tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </Foundation>
  );
}
