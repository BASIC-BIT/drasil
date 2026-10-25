'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  conversationReadResultSchema,
  type ConversationSource,
  type ConversationQuery,
  type ConversationReadResult,
} from '@/lib/conversationTypes';
import { mergeConversationWindow, type ConversationWindow } from '@/lib/conversationWindow';
import { Timestamp } from '@/components/workspace/Timestamp';
import styles from './ChannelConversation.module.css';
export interface ChannelConversationProps {
  readonly source: ConversationSource;
  readonly onBackToSource: () => void;
  readonly loadPage?: (
    guildId: string,
    query: ConversationQuery,
    signal: AbortSignal
  ) => Promise<ConversationReadResult>;
}
async function loadPage(
  guildId: string,
  query: ConversationQuery,
  signal: AbortSignal
): Promise<ConversationReadResult> {
  const params = new URLSearchParams({
    recordKind: query.recordKind,
    recordId: query.recordId,
    sourceKey: query.sourceKey,
    page: query.page.kind,
  });
  if (query.page.kind !== 'around') params.set('cursor', query.page.cursor);
  const response = await fetch(
    `/api/admin/guild/${encodeURIComponent(guildId)}/conversation?${params}`,
    { cache: 'no-store', signal }
  );
  if (!response.ok)
    return {
      kind: 'unavailable',
      reason: response.status === 401 || response.status === 403 ? 'denied' : 'upstream',
    };
  return conversationReadResultSchema.parse(await response.json());
}
export function ChannelConversation(props: ChannelConversationProps) {
  return (
    <ConversationReader
      key={`${props.source.guildId}:${props.source.recordKind}:${props.source.recordId}:${props.source.sourceKey}`}
      {...props}
    />
  );
}
function ConversationReader({
  source,
  onBackToSource,
  loadPage: read = loadPage,
}: ChannelConversationProps) {
  const [window, setWindow] = useState<ConversationWindow>({ messages: [], atLimit: false });
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'upstream'>(
    'loading'
  );
  const [extent, setExtent] = useState({
    earlier: false,
    later: false,
    sourcePresent: true,
    channelLabel: null as string | null,
    fetchedAt: null as string | null,
  });
  const list = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = useRef<AbortController | null>(null);
  const scroll = useRef<{ height: number; top: number } | null>(null);
  const initialScroll = useRef(false);
  const sourceMessage = useRef<HTMLElement | null>(null);
  async function page(kind: ConversationQuery['page']['kind']): Promise<void> {
    if (active.current || (kind !== 'around' && window.atLimit)) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus('loading');
    const cursor = kind === 'before' ? window.messages[0]?.id : window.messages.at(-1)?.id;
    if (kind !== 'around' && !cursor) {
      active.current = null;
      setStatus('ready');
      return;
    }
    try {
      const result = conversationReadResultSchema.parse(
        await read(
          source.guildId,
          {
            recordKind: source.recordKind,
            recordId: source.recordId,
            sourceKey: source.sourceKey,
            page: kind === 'around' ? { kind } : { kind, cursor: cursor! },
          },
          controller.signal
        )
      );
      if (controller.signal.aborted) return;
      if (result.kind === 'unavailable') {
        setStatus(result.reason);
        return;
      }
      if (
        result.source.guildId !== source.guildId ||
        result.source.recordKind !== source.recordKind ||
        result.source.recordId !== source.recordId ||
        result.source.sourceKey !== source.sourceKey ||
        result.source.channelId !== source.channelId ||
        result.source.messageId !== source.messageId ||
        result.messages.some((message) => message.channelId !== source.channelId)
      ) {
        setStatus('upstream');
        return;
      }
      if (kind === 'before' && list.current)
        scroll.current = { height: list.current.scrollHeight, top: list.current.scrollTop };
      initialScroll.current = kind === 'around';
      setWindow((current) =>
        mergeConversationWindow({
          current: current.messages,
          incoming: result.messages,
          direction: kind,
        })
      );
      setExtent((current) => ({
        earlier: kind === 'after' ? current.earlier : result.earlier,
        later: kind === 'before' ? current.later : result.later,
        sourcePresent: kind === 'around' ? result.sourcePresent : current.sourcePresent,
        channelLabel: result.channelLabel,
        fetchedAt: result.fetchedAt,
      }));
      setStatus('ready');
    } catch {
      if (!controller.signal.aborted) setStatus('upstream');
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  useEffect(() => {
    void page('around');
    heading.current?.focus({ preventScroll: true });
    return () => {
      active.current?.abort();
      active.current = null;
    };
    // This reader is remounted for each selected source. Paging uses current state.
  }, []);
  useLayoutEffect(() => {
    if (scroll.current && list.current) {
      list.current.scrollTop =
        scroll.current.top + list.current.scrollHeight - scroll.current.height;
      scroll.current = null;
    }
    if (initialScroll.current && list.current && sourceMessage.current) {
      list.current.scrollTop +=
        sourceMessage.current.getBoundingClientRect().top -
        list.current.getBoundingClientRect().top;
      initialScroll.current = false;
    }
  }, [window]);
  const unavailable = {
    denied: 'You do not have access to this conversation.',
    missing: 'This conversation is no longer available.',
    upstream: 'Conversation could not be loaded. Try again.',
  };
  return (
    <section className={styles.reader} aria-label="Channel conversation">
      <header className={styles.header}>
        <div>
          <h2 tabIndex={-1} ref={heading}>
            Conversation{extent.channelLabel ? ` · #${extent.channelLabel}` : ''}
          </h2>
          <p>Live channel messages</p>
        </div>
        <div className={styles.links}>
          <button type="button" onClick={onBackToSource}>
            Back to source
          </button>
          <a href={source.url} target="_blank" rel="noreferrer">
            Continue in Discord<span className={styles.srOnly}> in a new tab</span>
          </a>
        </div>
      </header>
      <div className={styles.extent} aria-live="polite">
        <p>
          {window.messages.length} messages loaded
          {window.messages.length ? (
            <>
              {' '}
              · <Timestamp value={window.messages[0].timestamp} /> –{' '}
              <Timestamp value={window.messages.at(-1)!.timestamp} />
            </>
          ) : null}
        </p>
        {extent.fetchedAt ? (
          <p>
            Fetched <Timestamp value={extent.fetchedAt} />
          </p>
        ) : null}
        {status === 'loading' ? (
          <p>Loading conversation…</p>
        ) : status !== 'ready' ? (
          <p role="status">{unavailable[status]}</p>
        ) : null}
        {!extent.sourcePresent ? <p>Source message is no longer available in this page.</p> : null}
        {window.atLimit ? <p>200-message limit reached. Continue in Discord.</p> : null}
      </div>
      <nav className={styles.paging} aria-label="Conversation pages">
        <button
          type="button"
          aria-disabled={!extent.earlier || window.atLimit || status !== 'ready'}
          onClick={() => {
            if (extent.earlier && !window.atLimit && status === 'ready') void page('before');
          }}
        >
          Load earlier
        </button>
        <button
          type="button"
          aria-disabled={!extent.later || window.atLimit || status !== 'ready'}
          onClick={() => {
            if (extent.later && !window.atLimit && status === 'ready') void page('after');
          }}
        >
          Load later
        </button>
        {status === 'upstream' ? (
          <button type="button" onClick={() => void page('around')}>
            Try again
          </button>
        ) : null}
      </nav>
      <div className={styles.messages} ref={list} tabIndex={0} aria-label="Loaded messages">
        {window.messages.map((message) => (
          <article
            key={`${message.channelId}:${message.id}`}
            data-source={message.id === source.messageId}
            ref={message.id === source.messageId ? sourceMessage : undefined}
          >
            <header>
              <strong>{message.authorLabel}</strong>
              <Timestamp value={message.timestamp} />
              {message.id === source.messageId ? <span>Source message</span> : null}
            </header>
            <p className={styles.body}>{message.content}</p>
            {message.attachments.map((attachment) =>
              attachment.url && /^https?:\/\//.test(attachment.url) ? (
                <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                  {attachment.filename ?? 'Attachment'}
                  <span className={styles.srOnly}> in a new tab</span>
                </a>
              ) : (
                <span key={attachment.id}>{attachment.filename ?? 'Attachment'} · unavailable</span>
              )
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
