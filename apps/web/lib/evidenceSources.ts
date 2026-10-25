import type { CaseDetail, ReportDetail, ReportEvidenceAttachment } from '@drasil/contracts';

export interface EvidenceSourceRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly origin: 'case_evidence' | 'report_evidence' | 'member_preview';
  readonly label: string;
  readonly content: string | null;
  readonly createdAt: string | null;
  readonly url: string | null;
  readonly attachment: ReportEvidenceAttachment | null;
}

export interface EvidenceSourceGroup {
  readonly id: string;
  readonly kind: 'saved_source' | 'recent_member_previews';
  readonly channelId: string | null;
  readonly messageId: string | null;
  readonly url: string | null;
  readonly records: readonly EvidenceSourceRecord[];
}

const labels: Readonly<Record<string, string>> = {
  reported_text: 'Reported message',
  reporter_text: 'Reporter statement',
  screenshot: 'Screenshot',
  message_link: 'Submitted message link',
  followup_answer: 'Reporter follow-up',
  candidate_confirmation: 'Target confirmation',
  admin_note: 'Moderator note',
};

function messageIdentity(url: string | null): { channelId: string; messageId: string } | null {
  if (!url) return null;
  const parsed = new URL(url);
  if (
    ![
      'discord.com',
      'www.discord.com',
      'canary.discord.com',
      'ptb.discord.com',
      'discordapp.com',
    ].includes(parsed.hostname)
  )
    return null;
  const match = /^\/channels\/[^/]+\/([^/]+)\/([^/]+)\/?$/.exec(parsed.pathname);
  return match ? { channelId: match[1], messageId: match[2] } : null;
}

export function groupEvidenceSources({
  detail,
  report,
}: {
  readonly detail: CaseDetail;
  readonly report: ReportDetail | null;
}): readonly EvidenceSourceGroup[] {
  const groups = new Map<string, EvidenceSourceGroup>();
  const add = (
    record: EvidenceSourceRecord,
    kind: EvidenceSourceGroup['kind'],
    identity: ReturnType<typeof messageIdentity>
  ): void => {
    const key =
      kind === 'recent_member_previews'
        ? `previews:${identity?.channelId ?? 'unknown'}`
        : identity
          ? `message:${identity.channelId}:${identity.messageId}`
          : record.url
            ? `url:${record.url}`
            : record.id;
    const existing = groups.get(key);
    groups.set(key, {
      id: key,
      kind,
      channelId: identity?.channelId ?? null,
      messageId: kind === 'saved_source' ? (identity?.messageId ?? null) : null,
      url: existing?.url ?? (kind === 'saved_source' ? record.url : null),
      records: [...(existing?.records ?? []), record],
    });
  };
  for (const item of detail.messageContext.filter((item) => item.isSource)) {
    add(
      {
        id: `preview:${item.id}`,
        sourceId: item.id,
        origin: 'member_preview',
        label: 'Source message preview',
        content: item.contentPreview,
        createdAt: item.createdAt,
        url: item.url,
        attachment: null,
      },
      'saved_source',
      item.channelId
        ? { channelId: item.channelId, messageId: item.messageId }
        : messageIdentity(item.url)
    );
  }
  for (const item of detail.evidenceItems) {
    add(
      {
        id: `case:${item.id}`,
        sourceId: item.id,
        origin: 'case_evidence',
        label: labels[item.kind] ?? item.kind.replace(/_/g, ' '),
        content: item.content,
        createdAt: item.createdAt,
        url: item.url,
        attachment: null,
      },
      'saved_source',
      messageIdentity(item.url)
    );
  }
  for (const item of report?.evidence ?? []) {
    add(
      {
        id: `report:${item.id}`,
        sourceId: item.id,
        origin: 'report_evidence',
        label: labels[item.kind] ?? item.kind.replace(/_/g, ' '),
        content: item.content,
        createdAt: item.createdAt,
        url: item.sourceMessageUrl,
        attachment: item.attachment,
      },
      'saved_source',
      messageIdentity(item.sourceMessageUrl)
    );
  }
  for (const item of detail.messageContext.filter((item) => !item.isSource)) {
    add(
      {
        id: `preview:${item.id}`,
        sourceId: item.id,
        origin: 'member_preview',
        label: 'Recent member message preview',
        content: item.contentPreview,
        createdAt: item.createdAt,
        url: item.url,
        attachment: null,
      },
      'recent_member_previews',
      item.channelId
        ? { channelId: item.channelId, messageId: item.messageId }
        : messageIdentity(item.url)
    );
  }
  return [...groups.values()];
}
