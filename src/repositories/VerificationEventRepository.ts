import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../di/symbols';
import { SupabaseRepository } from './SupabaseRepository';
import { VerificationEvent, VerificationStatus } from './types';
import { RepositoryError } from './errors';

export interface IVerificationEventRepository {
  findByUserAndServer(userId: string, serverId: string, options?: { limit?: number; offset?: number }): Promise<VerificationEvent[]>;
  findActiveByUserAndServer(userId: string, serverId: string): Promise<VerificationEvent | null>;
  findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]>;
  createFromDetection(detectionEventId: string, status: VerificationStatus): Promise<VerificationEvent>;
  updateStatus(id: string, status: VerificationStatus, adminId?: string, notes?: string): Promise<VerificationEvent>;
  getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]>;
}

@injectable()
export class VerificationEventRepository extends SupabaseRepository<VerificationEvent> implements IVerificationEventRepository {
  constructor(@inject(TYPES.SupabaseClient) supabase: SupabaseClient) {
    super(supabase, 'verification_events');
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<VerificationEvent[]> {
    try {
      let query = this.supabase
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
        throw new RepositoryError(`Error finding verification events for user ${userId} in server ${serverId}`, error);
      }

      return data as VerificationEvent[];
    } catch (error) {
      this.handleError(error);
      return [];
    }
  }

  async findActiveByUserAndServer(userId: string, serverId: string): Promise<VerificationEvent | null> {
    try {
      const { data, error } = await this.supabase
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
        throw new RepositoryError(`Error finding active verification event for user ${userId} in server ${serverId}`, error);
      }

      return data as VerificationEvent;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  async findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('detection_event_id', detectionEventId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new RepositoryError(`Error finding verification events for detection event ${detectionEventId}`, error);
      }

      return data as VerificationEvent[];
    } catch (error) {
      this.handleError(error);
      return [];
    }
  }

  async createFromDetection(detectionEventId: string, status: VerificationStatus): Promise<VerificationEvent> {
    try {
      // First, get the detection event to get server_id and user_id
      const { data: detectionEvent, error: detectionError } = await this.supabase
        .from('detection_events')
        .select('server_id, user_id')
        .eq('id', detectionEventId)
        .single();

      if (detectionError) {
        throw new RepositoryError(`Error finding detection event ${detectionEventId}`, detectionError);
      }

      if (!detectionEvent) {
        throw new RepositoryError(`Detection event ${detectionEventId} not found`);
      }

      const verificationEvent: Partial<VerificationEvent> = {
        server_id: detectionEvent.server_id,
        user_id: detectionEvent.user_id,
        detection_event_id: detectionEventId,
        status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {}
      };

      const { data, error } = await this.supabase
        .from(this.tableName)
        .insert(verificationEvent)
        .select()
        .single();

      if (error) {
        throw new RepositoryError('Error creating verification event', error);
      }

      if (!data) {
        throw new RepositoryError('No data returned when creating verification event');
      }

      // Update the detection event with the new verification event ID
      const { error: updateError } = await this.supabase
        .from('detection_events')
        .update({ latest_verification_event_id: data.id })
        .eq('id', detectionEventId);

      if (updateError) {
        console.error('Error updating detection event with verification event ID:', updateError);
      }

      return data as VerificationEvent;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async updateStatus(id: string, status: VerificationStatus, adminId?: string, notes?: string): Promise<VerificationEvent> {
    try {
      const updateData: Partial<VerificationEvent> = {
        status,
        updated_at: new Date().toISOString(),
        notes: notes || undefined
      };

      // If the status is final (verified or rejected), set resolved_at
      if (status === VerificationStatus.VERIFIED || status === VerificationStatus.REJECTED) {
        updateData.resolved_at = new Date().toISOString();
      }

      const { data, error } = await this.supabase
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
      this.handleError(error);
      throw error;
    }
  }

  async getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]> {
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }
} 