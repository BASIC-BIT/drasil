import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';
import { VerificationThread } from './types';
import { TYPES } from '../di/symbols';

/**
 * Interface for VerificationThreadRepository
 */
export interface IVerificationThreadRepository {
  /**
   * Find a verification thread by ID
   * @param id The thread UUID
   * @returns The verification thread or null if not found
   */
  findById(id: string): Promise<VerificationThread | null>;

  /**
   * Find a verification thread by Discord thread ID
   * @param serverId The Discord server ID
   * @param threadId The Discord thread ID
   * @returns The verification thread or null if not found
   */
  findByThreadId(serverId: string, threadId: string): Promise<VerificationThread | null>;

  /**
   * Find all verification threads for a specific user
   * @param userId The Discord user ID
   * @returns Array of verification threads
   */
  findByUser(userId: string): Promise<VerificationThread[]>;

  /**
   * Find all verification threads in a specific server
   * @param serverId The Discord server ID
   * @returns Array of verification threads
   */
  findByServer(serverId: string): Promise<VerificationThread[]>;

  /**
   * Find all verification threads with a specific status
   * @param serverId The Discord server ID
   * @param status The thread status
   * @returns Array of verification threads
   */
  findByStatus(
    serverId: string,
    status: 'open' | 'resolved' | 'abandoned'
  ): Promise<VerificationThread[]>;

  /**
   * Create a new verification thread
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param threadId The Discord thread ID
   * @returns The created verification thread
   */
  createThread(serverId: string, userId: string, threadId: string): Promise<VerificationThread>;

  /**
   * Update a thread status
   * @param serverId The Discord server ID
   * @param threadId The Discord thread ID
   * @param status The new status
   * @param resolvedBy Optional Discord ID of the user who resolved the thread
   * @param resolution Optional resolution outcome
   * @returns The updated verification thread
   */
  updateThreadStatus(
    serverId: string,
    threadId: string,
    status: 'open' | 'resolved' | 'abandoned',
    resolvedBy?: string,
    resolution?: 'verified' | 'banned' | 'ignored'
  ): Promise<VerificationThread | null>;

  /**
   * Find all open threads that haven't been updated in a certain time period
   * @param serverId The Discord server ID
   * @param olderThanHours Number of hours since last update
   * @returns Array of stale verification threads
   */
  findStaleThreads(serverId: string, olderThanHours: number): Promise<VerificationThread[]>;

  /**
   * Find a verification thread by server and user IDs
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns The verification thread or null if not found
   */
  findByServerAndUser(serverId: string, userId: string): Promise<VerificationThread | null>;
}

/**
 * Repository for managing verification threads
 */
@injectable()
export class VerificationThreadRepository
  extends SupabaseRepository<VerificationThread>
  implements IVerificationThreadRepository
{
  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('verification_events', supabaseClient);
  }

  /**
   * Find a verification thread by Discord thread ID
   * @param serverId The Discord server ID
   * @param threadId The Discord thread ID
   * @returns The verification thread or null if not found
   */
  async findByThreadId(serverId: string, threadId: string): Promise<VerificationThread | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('thread_id', threadId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as VerificationThread) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByThreadId');
    }
  }

  /**
   * Find all verification threads for a specific user
   * @param userId The Discord user ID
   * @returns Array of verification threads
   */
  async findByUser(userId: string): Promise<VerificationThread[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as VerificationThread[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findByUser');
    }
  }

  /**
   * Find all verification threads in a specific server
   * @param serverId The Discord server ID
   * @returns Array of verification threads
   */
  async findByServer(serverId: string): Promise<VerificationThread[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as VerificationThread[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findByServer');
    }
  }

  /**
   * Find all verification threads with a specific status
   * @param serverId The Discord server ID
   * @param status The thread status
   * @returns Array of verification threads
   */
  async findByStatus(
    serverId: string,
    status: 'open' | 'resolved' | 'abandoned'
  ): Promise<VerificationThread[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('status', status)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as VerificationThread[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findByStatus');
    }
  }

  /**
   * Create a new verification thread
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param threadId The Discord thread ID
   * @returns The created verification thread
   */
  async createThread(
    serverId: string,
    userId: string,
    threadId: string
  ): Promise<VerificationThread> {
    try {
      const thread = {
        server_id: serverId,
        user_id: userId,
        thread_id: threadId,
        created_at: new Date().toISOString(),
        status: 'open',
      };

      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .insert(thread)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create verification thread: No data returned');

      return data as VerificationThread;
    } catch (error) {
      this.handleError(error as Error, 'createThread');
    }
  }

  /**
   * Update a thread status
   * @param serverId The Discord server ID
   * @param threadId The Discord thread ID
   * @param status The new status
   * @param resolvedBy Optional Discord ID of the user who resolved the thread
   * @param resolution Optional resolution outcome
   * @returns The updated verification thread
   */
  async updateThreadStatus(
    serverId: string,
    threadId: string,
    status: 'open' | 'resolved' | 'abandoned',
    resolvedBy?: string,
    resolution?: 'verified' | 'banned' | 'ignored'
  ): Promise<VerificationThread | null> {
    try {
      const updateData: Partial<VerificationThread> = {
        status,
      };

      // If the thread is being resolved, set the resolved_at timestamp and other fields
      if (status === 'resolved') {
        updateData.resolved_at = new Date().toISOString();
        if (resolvedBy) updateData.resolved_by = resolvedBy;
        if (resolution) updateData.resolution = resolution;
      }

      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update(updateData)
        .eq('server_id', serverId)
        .eq('thread_id', threadId)
        .select()
        .single();

      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return data as VerificationThread;
    } catch (error) {
      this.handleError(error as Error, 'updateThreadStatus');
    }
  }

  /**
   * Find all open threads that haven't been updated in a certain time period
   * @param serverId The Discord server ID
   * @param olderThanHours Number of hours since last update
   * @returns Array of stale verification threads
   */
  async findStaleThreads(serverId: string, olderThanHours: number): Promise<VerificationThread[]> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - olderThanHours);
      const cutoffString = cutoffTime.toISOString();

      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('status', 'open')
        .lt('created_at', cutoffString)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data as VerificationThread[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findStaleThreads');
    }
  }

  /**
   * Find a verification thread by server and user IDs
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns The verification thread or null if not found
   */
  async findByServerAndUser(serverId: string, userId: string): Promise<VerificationThread | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as VerificationThread) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByServerAndUser');
    }
  }
}
