'use client';

import { useRef, useState } from 'react';
import { ActionButton } from '@/components/workspace/Foundation';
import { Timestamp } from '@/components/workspace/Timestamp';
import type { ResultView, StudyAction } from './workflowStudyState';
import styles from './WorkflowStudyPanels.module.css';

const messages = [
  {
    id: 'message-1',
    author: 'juniper',
    content: 'Is there an announcement for this event?',
    at: '2026-10-23T15:06:00Z',
  },
  {
    id: 'message-2',
    author: 'fieldnote',
    content: 'Claim a reward here before it expires.',
    at: '2026-10-23T15:07:00Z',
    source: true,
  },
  {
    id: 'message-3',
    author: 'northline',
    content: 'That link asks me to sign in on another site.',
    at: '2026-10-23T15:07:20Z',
  },
  {
    id: 'message-4',
    author: 'juniper',
    content: 'Please wait for the moderators to check it.',
    at: '2026-10-23T15:08:00Z',
  },
  {
    id: 'message-5',
    author: 'riverstone',
    content: 'I have sent a report with the screenshot.',
    at: '2026-10-23T15:09:00Z',
  },
];

export function ChannelConversationStudy({
  unavailable = false,
}: {
  readonly unavailable?: boolean;
}) {
  const [older, setOlder] = useState(false);
  const [newer, setNewer] = useState(false);
  const source = useRef<HTMLHeadingElement>(null);
  const contextSource = useRef<HTMLDivElement>(null);
  return (
    <>
      <section className={styles.saved}>
        <header className={styles.heading}>
          <h2 ref={source} tabIndex={-1}>
            Saved source
          </h2>
          <a
            href="https://discord.com/channels/guild-1/source-channel-1/source-message-1"
            target="_blank"
            rel="noreferrer"
          >
            Discord ↗
          </a>
        </header>
        <p className={styles.meta}>
          Message excerpt · <Timestamp value="2026-10-23T15:07:00Z" />
        </p>
        <blockquote>Claim a reward here before it expires.</blockquote>
        {!unavailable ? (
          <button
            className={styles.textButton}
            type="button"
            onClick={() => {
              contextSource.current?.scrollIntoView({ block: 'center' });
              contextSource.current?.focus({ preventScroll: true });
            }}
          >
            View in conversation ↓
          </button>
        ) : null}
      </section>
      <section className={styles.conversation} aria-label="Channel conversation">
        <header className={styles.heading}>
          <h2>Conversation</h2>
          <button
            className={styles.textButton}
            type="button"
            onClick={() => {
              source.current?.scrollIntoView({ block: 'center' });
              source.current?.focus({ preventScroll: true });
            }}
          >
            ↑ Back to source
          </button>
        </header>
        {unavailable ? (
          <div className={styles.notice}>
            <h3>Conversation unavailable</h3>
            <p>You don’t have access to this channel’s message history.</p>
            <p className={styles.meta}>Saved evidence remains available above.</p>
          </div>
        ) : (
          <>
            <p className={styles.meta}>
              #general · {messages.length + (older ? 2 : 0) + (newer ? 1 : 0)} messages loaded
            </p>
            <p className={styles.meta}>
              Fetched <Timestamp value="2026-10-23T15:12:00Z" />
            </p>
            {!older ? (
              <button className={styles.load} type="button" onClick={() => setOlder(true)}>
                Load earlier messages ↑
              </button>
            ) : (
              <div className={styles.message}>
                <header>
                  <strong>orbit</strong>
                  <Timestamp value="2026-10-23T15:05:00Z" />
                </header>
                <p>Has the event started yet?</p>
                <header>
                  <strong>juniper</strong>
                  <Timestamp value="2026-10-23T15:05:20Z" />
                </header>
                <p>I haven’t seen anything from the team.</p>
              </div>
            )}
            <div className={styles.stream}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  ref={message.source ? contextSource : undefined}
                  tabIndex={message.source ? -1 : undefined}
                  className={styles.message}
                  data-source={message.source || undefined}
                >
                  <header>
                    <strong>{message.author}</strong>
                    {message.source ? (
                      <span className={styles.sourceLabel}>Source message</span>
                    ) : null}
                    <Timestamp value={message.at} />
                  </header>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
            {newer ? (
              <div className={styles.message}>
                <header>
                  <strong>juniper</strong>
                  <Timestamp value="2026-10-23T15:10:00Z" />
                </header>
                <p>The moderation team has the report now.</p>
              </div>
            ) : (
              <button className={styles.load} type="button" onClick={() => setNewer(true)}>
                Load later messages ↓
              </button>
            )}
          </>
        )}
        {!unavailable ? (
          <p className={styles.meta}>
            Loaded window ·{' '}
            <a
              href="https://discord.com/channels/guild-1/source-channel-1/source-message-1"
              target="_blank"
              rel="noreferrer"
            >
              Continue reading in Discord ↗
            </a>
          </p>
        ) : null}
      </section>
    </>
  );
}

const results: Record<
  ResultView,
  {
    readonly title: string;
    readonly text: string;
    readonly state: string;
    readonly tone: 'neutral' | 'warning' | 'danger' | 'positive';
  }
> = {
  queued: {
    title: 'Ban queued',
    text: 'Waiting for Drasil to process the request.',
    state: 'Queued',
    tone: 'neutral',
  },
  processing: {
    title: 'Ban in progress',
    text: 'Drasil is processing this request.',
    state: 'Processing',
    tone: 'neutral',
  },
  failed: {
    title: 'Ban request failed',
    text: 'The worker stopped before the request completed. Check the current ban and case state before another attempt.',
    state: 'Failed',
    tone: 'danger',
  },
  updates_pending: {
    title: 'Banned. Report updates pending.',
    text: 'Discord confirmed the ban. Drasil is reconciling the report updates.',
    state: 'Updates pending',
    tone: 'warning',
  },
  unknown: {
    title: 'Ban outcome needs review',
    text: 'Discord did not confirm the result. Drasil is checking the current ban without sending another ban.',
    state: 'Outcome unknown',
    tone: 'warning',
  },
  resolved_elsewhere: {
    title: 'Case resolved',
    text: 'moderator-2 verified fieldnote. The case role was removed.',
    state: 'Verified',
    tone: 'positive',
  },
};
export function ResultStudy({
  view,
  onAction,
}: {
  readonly view: ResultView;
  readonly onAction: (action: StudyAction) => void;
}) {
  const value = results[view];
  const [checked, setChecked] = useState(false);
  return (
    <section className={styles.result} data-tone={value.tone} aria-label="Action result">
      <p className={styles.state}>{value.state}</p>
      <h2>{value.title}</h2>
      <p>{value.text}</p>
      {view === 'resolved_elsewhere' ? (
        <p className={styles.meta}>
          Recorded <Timestamp value="2026-10-23T15:14:00Z" /> · moderator-2
        </p>
      ) : (
        <p className={styles.meta}>
          Requested by moderator-1 · <Timestamp value="2026-10-23T15:12:00Z" />
        </p>
      )}
      <div className={styles.actions}>
        <a href="/admin/guild/guild-1/operations#request-workflow-1">View request</a>
        {view === 'failed' || view === 'unknown' ? (
          <ActionButton onClick={() => setChecked(true)}>Refresh current state</ActionButton>
        ) : null}
        {view === 'resolved_elsewhere' ? (
          <ActionButton
            onClick={() =>
              onAction({
                id: 'reopen',
                label: 'Reopen case',
                effect: 'Reopen this case for review and restore the case role and case thread.',
              })
            }
          >
            Reopen case
          </ActionButton>
        ) : null}
      </div>
      {checked ? (
        <p className={styles.meta} role="status">
          No newer confirmed result is available.
        </p>
      ) : null}
      <details>
        <summary>Request details</summary>
        <dl>
          <dt>Request</dt>
          <dd>request-workflow-1</dd>
          <dt>Member</dt>
          <dd>fieldnote · user-100</dd>
          <dt>Server</dt>
          <dd>Community</dd>
          <dt>Reason</dt>
          <dd>Repeated reward links in a public channel.</dd>
          {view === 'updates_pending' || view === 'unknown' ? (
            <>
              <dt>Operation</dt>
              <dd>operation-workflow-1</dd>
            </>
          ) : null}
        </dl>
      </details>
    </section>
  );
}
