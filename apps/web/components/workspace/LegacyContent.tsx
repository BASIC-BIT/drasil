import type { ReactNode } from 'react';
import styles from './LegacyContent.module.css';

/** Scoped palette and spacing for existing forms while they share workspace chrome. */
export function LegacyContent({ children }: { readonly children: ReactNode }) {
  return <div className={`${styles.bridge} ${styles.gutter} stack`}>{children}</div>;
}
