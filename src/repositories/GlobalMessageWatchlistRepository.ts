import { injectable, inject } from 'inversify';
import { PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import type { GlobalMessageWatchlistEntry } from './types';

interface GlobalMessageWatchlistEntryRow {
  readonly id: string;
  readonly label: string;
  readonly term: string;
  readonly requires_link_or_video: boolean;
}

export interface IGlobalMessageWatchlistRepository {
  findEnabled(): Promise<GlobalMessageWatchlistEntry[]>;
}

@injectable()
export class GlobalMessageWatchlistRepository implements IGlobalMessageWatchlistRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);
    if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    }

    throw new RepositoryError(`Unknown error during ${operation}`, error);
  }

  async findEnabled(): Promise<GlobalMessageWatchlistEntry[]> {
    try {
      const rows = await this.prisma.$queryRaw<GlobalMessageWatchlistEntryRow[]>`
        SELECT id, label, term, requires_link_or_video
        FROM public.global_message_watchlist_entries
        WHERE enabled = true
        ORDER BY created_at ASC NULLS LAST, id ASC
      `;

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        term: row.term,
        requiresLinkOrVideo: row.requires_link_or_video,
      }));
    } catch (error) {
      this.handleError(error, 'findEnabledGlobalMessageWatchlistEntries');
    }
  }
}
