import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DrasilBrand, Foundation } from './Foundation';
import bridge from './LegacyContent.module.css';
import styles from './PublicShell.module.css';

/** Public entries keep ownership of their main landmark and authentication. */
export function PublicShell({
  children,
  brandHref = '/',
  actions,
}: {
  readonly children: ReactNode;
  readonly brandHref?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <Foundation>
      <div className={bridge.bridge}>
        <header className={styles.header}>
          <DrasilBrand href={brandHref} />
          {actions ? <div className={styles.actions}>{actions}</div> : null}
          <ThemeToggle />
        </header>
        {children}
      </div>
    </Foundation>
  );
}
