import type { ReportDirectoryCoverage } from '@drasil/application';
import { Guild, GuildMember } from 'discord.js';
import { injectable } from 'inversify';

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const SCAN_DEADLINE_MS = 15000;
const SNAPSHOT_LIFETIME_MS = 5 * 60 * 1000;
export interface ReportDirectoryMember {
  id: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  displayName: string;
}
export interface ReportDirectorySnapshot {
  coverage: ReportDirectoryCoverage;
  members: readonly ReportDirectoryMember[];
}
export interface IReportMemberDirectory {
  snapshot(guild: Guild, signal: AbortSignal): Promise<ReportDirectorySnapshot>;
  invalidate(guildId?: string): void;
}
interface Scan {
  controller: AbortController;
  promise: Promise<ReportDirectorySnapshot>;
  snapshot?: ReportDirectorySnapshot;
  outstanding?: Promise<unknown>;
}
export function reportDirectoryMember(member: GuildMember): ReportDirectoryMember {
  return {
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName ?? null,
    nickname: member.nickname ?? null,
    displayName: member.nickname ?? member.user.globalName ?? member.user.username,
  };
}

// shortcut: SDK member calls cannot cancel REST; discard late results until SDK adds abort support.
export async function awaitReportLookup<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = (): void => reject(new Error('Report lookup interrupted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, interrupted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

@injectable()
export class ReportMemberDirectory implements IReportMemberDirectory {
  private scans = new Map<string, Scan>();

  async snapshot(guild: Guild, signal: AbortSignal): Promise<ReportDirectorySnapshot> {
    if (signal.aborted) return this.interrupted();
    let scan = this.scans.get(guild.id);
    if (
      scan?.snapshot?.coverage.kind === 'complete' &&
      Date.parse(scan.snapshot.coverage.expiresAt) <= Date.now()
    ) {
      this.scans.delete(guild.id);
      scan = undefined;
    }
    if (!scan) {
      scan = { controller: new AbortController(), promise: Promise.resolve(this.interrupted()) };
      this.scans.set(guild.id, scan);
      scan.promise = this.load(guild, scan);
    }
    try {
      return await awaitReportLookup(scan.promise, signal);
    } catch {
      return this.interrupted();
    }
  }

  invalidate(guildId?: string): void {
    for (const [id, scan] of this.scans) {
      if (guildId !== undefined && id !== guildId) continue;
      scan.controller.abort();
      if (scan.snapshot) this.scans.delete(id);
    }
  }

  private interrupted(): ReportDirectorySnapshot {
    const now = new Date().toISOString();
    return {
      members: [],
      coverage: {
        kind: 'partial',
        reason: 'interrupted',
        scannedAt: now,
        expiresAt: now,
        memberCount: 0,
      },
    };
  }

  private async load(guild: Guild, scan: Scan): Promise<ReportDirectorySnapshot> {
    const started = Date.now();
    const members = new Map<string, ReportDirectoryMember>();
    let memberCount = 0;
    const timer = setTimeout(() => {
      scan.controller.abort('deadline');
    }, SCAN_DEADLINE_MS);
    const coverage = (
      reason?: 'page_limit' | 'deadline' | 'interrupted'
    ): ReportDirectoryCoverage => ({
      ...(reason ? { kind: 'partial' as const, reason } : { kind: 'complete' as const }),
      scannedAt: new Date(started).toISOString(),
      expiresAt: new Date(started + SNAPSHOT_LIFETIME_MS).toISOString(),
      memberCount,
    });
    let result: ReportDirectorySnapshot;
    try {
      let after: string | undefined;
      let complete = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const request = guild.members.list({
          limit: PAGE_SIZE,
          cache: false,
          ...(after ? { after } : {}),
        });
        scan.outstanding = request;
        void request.then(
          () => {
            if (scan.outstanding === request) scan.outstanding = undefined;
          },
          () => {
            if (scan.outstanding === request) scan.outstanding = undefined;
          }
        );
        const listed = await awaitReportLookup(request, scan.controller.signal);
        if (scan.controller.signal.aborted) throw new Error('Invalidated directory');
        memberCount += listed.size;
        for (const member of listed.values()) {
          if (!member.user.bot) members.set(member.id, reportDirectoryMember(member));
        }
        if (listed.size < PAGE_SIZE) {
          complete = true;
          break;
        }
        const next = [...listed.keys()].reduce(
          (max, id) => (BigInt(id) > BigInt(max) ? id : max),
          after ?? '0'
        );
        if (next === after) throw new Error('Directory cursor did not advance');
        after = next;
      }
      result = {
        members: [...members.values()],
        coverage: coverage(complete ? undefined : 'page_limit'),
      };
    } catch (error) {
      if (scan.controller.signal.aborted)
        result = {
          members: [...members.values()],
          coverage: coverage(
            scan.controller.signal.reason === 'deadline' ? 'deadline' : 'interrupted'
          ),
        };
      else {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const status =
          error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        result = {
          members: [...members.values()],
          coverage: {
            kind: 'unavailable',
            reason:
              code === 50013 || code === 50001 || status === 403
                ? 'permissions'
                : status === 429
                  ? 'rate_limited'
                  : 'transport',
          },
        };
      }
    } finally {
      clearTimeout(timer);
    }
    if (result.coverage.kind === 'complete' && !scan.controller.signal.aborted)
      scan.snapshot = result;
    else {
      const release = (): void => {
        if (this.scans.get(guild.id) === scan) this.scans.delete(guild.id);
      };
      // Keep the failed generation coalesced until its uncancellable request settles.
      if (scan.outstanding) void scan.outstanding.then(release, release);
      else release();
    }
    return result;
  }
}
