import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../di/symbols';
import { SupabaseRepository, RepositoryError } from './BaseRepository';
import { VerificationEvent, VerificationStatus } from './types';

export interface IVerificationEventRepository {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<VerificationEvent[]>;
  findActiveByUserAndServer(userId: string, serverId: string): Promise<VerificationEvent | null>;
  findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]>;
  createFromDetection(
    detectionEventId: string | null,
    status: VerificationStatus
  ): Promise<VerificationEvent>;
  updateStatus(
    id: string,
    status: VerificationStatus,
    adminId?: string,
    notes?: string
  ): Promise<VerificationEvent>;
  getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]>;
  findById(id: string): Promise<VerificationEvent | null>;
  update(id: string, data: Partial<VerificationEvent>): Promise<VerificationEvent>;
}

@injectable()
export class VerificationEventRepository
  extends SupabaseRepository<VerificationEvent>
  implements IVerificationEventRepository
{
  protected readonly supabaseClient: SupabaseClient;

  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('verification_events', supabaseClient);
    this.supabaseClient = supabaseClient;
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<VerificationEvent[]> {
    try {
      let query = this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .eq('server_id', serverId)
        .order('created_at', { ascending: false });

      if (options.limit !== undefined) {
        query = query.limit(options.limit);
      }
      if (options.offset !== undefined) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new RepositoryError(
          `Error finding verification events for user ${userId} in server ${serverId}`,
          error
        );
      }

      return data as VerificationEvent[];
    } catch (error) {
      this.handleError(error as Error, 'findByUserAndServer');
      return [];
    }
  }

  async findActiveByUserAndServer(
    userId: string,
    serverId: string
  ): Promise<VerificationEvent | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .eq('server_id', serverId)
        .eq('status', VerificationStatus.PENDING)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new RepositoryError(
          `Error finding active verification event for user ${userId} in server ${serverId}`,
          error
        );
      }

      return data as VerificationEvent;
    } catch (error) {
      this.handleError(error as Error, 'findActiveByUserAndServer');
      return null;
    }
  }

  async findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('detection_event_id', detectionEventId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new RepositoryError(
          `Error finding verification events for detection event ${detectionEventId}`,
          error
        );
      }

      return data as VerificationEvent[];
    } catch (error) {
      this.handleError(error as Error, 'findByDetectionEvent');
      return [];
    }
  }

  async createFromDetection(
    detectionEventId: string | null,
    status: VerificationStatus
  ): Promise<VerificationEvent> {
    try {
      let fetchedServerId: string | null = null;
      let fetchedUserId: string | null = null;

      if (detectionEventId) {
        const { data: detectionEvent, error: detectionError } = await this.supabaseClient
          .from('detection_events')
          .select('server_id, user_id')
          .eq('id', detectionEventId)
          .single();

        if (detectionError) {
          throw new RepositoryError(
            `Error finding detection event ${detectionEventId}`,
            detectionError
          );
        }

        if (!detectionEvent.server_id || !detectionEvent.user_id) {
          throw new RepositoryError(
            `Detection event ${detectionEventId} is missing required fields (server_id or user_id)`
          );
        }
        fetchedServerId = detectionEvent.server_id;
        fetchedUserId = detectionEvent.user_id;
      }

      if (!fetchedServerId || !fetchedUserId) {
        throw new RepositoryError(
          'Cannot create verification event: Missing server_id or user_id context.'
        );
      }

      const now = new Date().toISOString();
      const newEventData: Omit<VerificationEvent, 'id' | 'updated_at'> & { updated_at?: string } = {
        server_id: fetchedServerId,
        user_id: fetchedUserId,
        detection_event_id: detectionEventId,
        status,
        created_at: now,
        metadata: {},
        thread_id: null,
        notification_message_id: null,
        resolved_at: null,
        resolved_by: null,
        notes: null,
      };

      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .insert(newEventData)
        .select()
        .single();

      if (error) {
        throw new RepositoryError('Error creating verification event', error);
      }

      if (!data) {
        throw new RepositoryError('No data returned when creating verification event');
      }

      if (detectionEventId && data) {
        const { error: updateError } = await this.supabaseClient
          .from('detection_events')
          .update({ latest_verification_event_id: data.id })
          .eq('id', detectionEventId);

        if (updateError) {
          console.error('Error updating detection event with verification event ID:', updateError);
        }
      }

      return data as VerificationEvent;
    } catch (error) {
      this.handleError(error as Error, 'createFromDetection');
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: VerificationStatus,
    adminId?: string,
    notes?: string
  ): Promise<VerificationEvent> {
    try {
      const now = new Date().toISOString();
      const updateData: Partial<VerificationEvent> = {
        status,
        updated_at: now,
        notes: notes || undefined,
      };

      if (status === VerificationStatus.VERIFIED || status === VerificationStatus.BANNED) {
        updateData.resolved_at = now;
        updateData.resolved_by = adminId || null;
      }

      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new RepositoryError(`Error updating verification event ${id}`, error);
      }

      if (!data) {
        throw new RepositoryError(`Verification event ${id} not found`);
      }

      return data as VerificationEvent;
    } catch (error) {
      this.handleError(error as Error, 'updateStatus');
      throw error;
    }
  }

  async getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]> {
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }

  async findById(id: string): Promise<VerificationEvent | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        throw new RepositoryError(`Error finding verification event ${id}`, error);
      }

      return data as VerificationEvent | null;
    } catch (error) {
      this.handleError(error as Error, 'findById');
      return null;
    }
  }

  async update(id: string, data: Partial<VerificationEvent>): Promise<VerificationEvent> {
    try {
      const { data: updatedData, error } = await this.supabaseClient
        .from(this.tableName)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new RepositoryError(`Error updating verification event ${id}`, error);
      }

      if (!updatedData) {
        throw new RepositoryError(`Verification event ${id} not found`);
      }

      return updatedData as VerificationEvent;
    } catch (error) {
      this.handleError(error as Error, 'update');
      throw error;
    }
  }
}
