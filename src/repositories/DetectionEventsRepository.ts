import { injectable, inject } from 'inversify';
import { SupabaseRepository } from './SupabaseRepository';
import { DetectionEvent } from './types';
import { TYPES } from '../di/symbols';
import { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * Interface for Detection Events Repository
 */
export interface IDetectionEventsRepository {
  /**
   * Create a new detection event
   * @param data The detection event data
   * @returns The created detection event
   */
  create(data: Partial<DetectionEvent>): Promise<DetectionEvent>;

  /**
   * Find detection events for a specific user in a server
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns Array of detection events
   */
  findByServerAndUser(serverId: string, userId: string): Promise<DetectionEvent[]>;

  /**
   * Find recent detection events for a server
   * @param serverId The Discord server ID
   * @param limit Maximum number of events to return
   * @returns Array of detection events
   */
  findRecentByServer(serverId: string, limit?: number): Promise<DetectionEvent[]>;

  /**
   * Record an admin action on a detection event
   * @param id The detection event ID
   * @param action The admin action taken
   * @param adminId The Discord ID of the admin
   * @returns The updated detection event
   */
  recordAdminAction(
    id: string,
    action: 'Verified' | 'Banned' | 'Ignored',
    adminId: string
  ): Promise<DetectionEvent | null>;

  /**
   * Get detection statistics for a server within a date range
   * @param serverId The Discord server ID
   * @param startDate Start date for statistics
   * @param endDate End date for statistics
   * @returns Statistics object
   */
  getServerStats(
    serverId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    total: number;
    verified: number;
    banned: number;
    ignored: number;
    pending: number;
  }>;

  /**
   * Clean up old detection events based on retention policy
   * @param retentionDays Number of days to retain events
   * @returns Number of deleted events
   */
  cleanupOldEvents(retentionDays: number): Promise<number>;
}

/**
 * Repository for managing detection events
 */
@injectable()
export class DetectionEventsRepository
  extends SupabaseRepository<DetectionEvent, string>
  implements IDetectionEventsRepository
{
  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('detection_events', supabaseClient);
  }

  /**
   * Create a new detection event
   * @param data The detection event data
   * @returns The created detection event
   */
  async create(data: Partial<DetectionEvent>): Promise<DetectionEvent> {
    try {
      if (!data.server_id || !data.user_id) {
        throw new Error('server_id and user_id are required to create a detection event');
      }

      // Create the detection event
      const { data: created, error } = await this.supabaseClient
        .from(this.tableName)
        .insert(data)
        .select()
        .single<DetectionEvent>();

      if (error) {
        console.error('Error creating detection event:', error);
        throw error;
      }

      if (!created) {
        throw new Error('Failed to create detection event: No data returned');
      }

      return created;
    } catch (error: unknown) {
      console.error('Exception in create detection event:', error);
      if (error instanceof Error || this.isPostgrestError(error)) {
        throw this.handleError(error, 'create');
      }
      throw error;
    }
  }

  /**
   * Find detection events for a specific user in a server
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns Array of detection events
   */
  async findByServerAndUser(serverId: string, userId: string): Promise<DetectionEvent[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .order('detected_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error: unknown) {
      if (error instanceof Error || this.isPostgrestError(error)) {
        throw this.handleError(error, 'findByServerAndUser');
      }
      throw error;
    }
  }

  /**
   * Find recent detection events for a server
   * @param serverId The Discord server ID
   * @param limit Maximum number of events to return
   * @returns Array of detection events
   */
  async findRecentByServer(serverId: string, limit: number = 50): Promise<DetectionEvent[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .order('detected_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data as DetectionEvent[]) || [];
    } catch (error: unknown) {
      if (error instanceof Error || this.isPostgrestError(error)) {
        this.handleError(error, 'findRecentByServer');
      }
      return [];
    }
  }

  /**
   * Record an admin action on a detection event
   * @param id The detection event ID
   * @param action The admin action taken
   * @param adminId The Discord ID of the admin
   * @returns The updated detection event
   */
  async recordAdminAction(
    id: string,
    action: 'Verified' | 'Banned' | 'Ignored',
    adminId: string
  ): Promise<DetectionEvent | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          admin_action: action,
          admin_action_by: adminId,
          admin_action_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return (data as DetectionEvent) || null;
    } catch (error: unknown) {
      if (error instanceof Error || this.isPostgrestError(error)) {
        this.handleError(error, 'recordAdminAction');
      }
      return null;
    }
  }

  /**
   * Get detection statistics for a server within a date range
   * @param serverId The Discord server ID
   * @param startDate Start date for statistics
   * @param endDate End date for statistics
   * @returns Statistics object
   */
  async getServerStats(
    serverId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    total: number;
    verified: number;
    banned: number;
    ignored: number;
    pending: number;
  }> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .gte('detected_at', startDate.toISOString())
        .lte('detected_at', endDate.toISOString());

      if (error) throw error;

      const events = data as DetectionEvent[];
      return {
        total: events.length,
        verified: events.filter((e) => e.admin_action === 'Verified').length,
        banned: events.filter((e) => e.admin_action === 'Banned').length,
        ignored: events.filter((e) => e.admin_action === 'Ignored').length,
        pending: events.filter((e) => !e.admin_action).length,
      };
    } catch (error: unknown) {
      if (error instanceof Error || this.isPostgrestError(error)) {
        this.handleError(error, 'getServerStats');
      }
      return {
        total: 0,
        verified: 0,
        banned: 0,
        ignored: 0,
        pending: 0,
      };
    }
  }

  /**
   * Clean up old detection events based on retention policy
   * @param retentionDays Number of days to retain events
   * @returns Number of deleted events
   */
  async cleanupOldEvents(retentionDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const { count, error } = await this.supabaseClient
        .from(this.tableName)
        .delete({ count: 'exact' })
        .lt('detected_at', cutoffDate.toISOString());

      if (error) throw error;
      return count || 0;
    } catch (error: unknown) {
      if (error instanceof Error || this.isPostgrestError(error)) {
        this.handleError(error, 'cleanupOldEvents');
      }
      return 0;
    }
  }

  /**
   * Type guard for PostgrestError
   * @param error Unknown error to check
   * @returns Boolean indicating if error is a PostgrestError
   */
  private isPostgrestError(error: unknown): error is PostgrestError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      'details' in error
    );
  }
}
