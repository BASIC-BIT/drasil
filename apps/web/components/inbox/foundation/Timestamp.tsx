'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import styles from './Timestamp.module.css';

const minute = 60_000;
const relativeFormat = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' });
const units: readonly {
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly milliseconds: number;
}[] = [
  { unit: 'year', milliseconds: 365 * 24 * 60 * minute },
  { unit: 'month', milliseconds: 30 * 24 * 60 * minute },
  { unit: 'day', milliseconds: 24 * 60 * minute },
  { unit: 'hour', milliseconds: 60 * minute },
  { unit: 'minute', milliseconds: minute },
];

function relativeAge(value: string, now: number, format: 'datetime' | 'date' | 'time'): string {
  if (format === 'date') {
    const today = new Date(now).toISOString().slice(0, 10);
    now = Date.parse(today);
    value = value.slice(0, 10);
  }
  const difference = Date.parse(value) - now;
  for (const { unit, milliseconds } of units) {
    if (Math.abs(difference) >= milliseconds) {
      return relativeFormat.format(Math.trunc(difference / milliseconds), unit);
    }
  }
  return format === 'date' ? 'today' : 'just now';
}

const ClockContext = createContext<number | null>(null);
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
  timeZone: 'UTC',
});
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

export function TimestampClock({ children }: { readonly children: ReactNode }) {
  // Render the absolute time on the server and first client render to keep hydration stable.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = (): void => setNow(Date.now());
    update();
    const interval = window.setInterval(update, minute);
    return () => window.clearInterval(interval);
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

export function Timestamp({
  value,
  format = 'datetime',
  prefix,
}: {
  readonly value: string;
  readonly format?: 'datetime' | 'date' | 'time';
  readonly prefix?: string;
}) {
  const now = useContext(ClockContext);
  return (
    <time
      dateTime={value}
      title={format === 'time' ? dateTimeFormat.format(new Date(value)) : undefined}
    >
      {prefix ? `${prefix} ` : null}
      {(format === 'date' ? dateFormat : format === 'time' ? timeFormat : dateTimeFormat).format(
        new Date(value)
      )}
      {now !== null ? (
        <>
          {' '}
          <span className={styles.relativeAge}>
            <span aria-hidden="true">· </span>
            {relativeAge(value, now, format)}
          </span>
        </>
      ) : null}
    </time>
  );
}
