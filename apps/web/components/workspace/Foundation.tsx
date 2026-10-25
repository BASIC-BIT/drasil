import type { ComponentPropsWithRef, ReactNode } from 'react';
import { TimestampClock } from './Timestamp';
import styles from './Foundation.module.css';

export type FoundationTheme = 'system' | 'light' | 'dark';

export function Foundation({
  children,
  theme = 'system',
}: {
  readonly children: ReactNode;
  readonly theme?: FoundationTheme;
}) {
  return (
    <div className={styles.root} data-foundation-theme={theme}>
      <TimestampClock>{children}</TimestampClock>
    </div>
  );
}

export function DrasilBrand({ href = '#inbox' }: { readonly href?: string }) {
  return (
    <a className={styles.brand} href={href}>
      <img src="/brand/drasil-tree.png" width={56} height={56} alt="" />
      <span>Drasil</span>
    </a>
  );
}

interface ActionButtonProps extends ComponentPropsWithRef<'button'> {
  readonly tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}

export function ActionButton({
  tone = 'neutral',
  className = '',
  type = 'button',
  ...props
}: ActionButtonProps) {
  return (
    <button {...props} type={type} className={`${styles.button} ${className}`} data-tone={tone} />
  );
}
