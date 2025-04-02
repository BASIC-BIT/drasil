import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../di/symbols';
import { SupabaseRepository, RepositoryError } from './BaseRepository';
import { AdminAction, AdminActionCreate } from './types';

export interface IAdminActionRepository {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  findByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  findByVerificationEvent(verificationEventId: string): Promise<AdminAction[]>;
  createAction(data: AdminActionCreate): Promise<AdminAction>;
  getActionHistory(userId: string, serverId: string): Promise<AdminAction[]>;
}

@injectable()
export class AdminActionRepository
  extends SupabaseRepository<AdminAction>
  implements IAdminActionRepository
{
  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('admin_actions', supabaseClient);
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AdminAction[]> {
    try {
      let query = this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .eq('server_id', serverId)
        .order('action_at', { ascending: false });

      if (options.limit !== undefined) {
        query = query.limit(options.limit);
      }
      if (options.offset !== undefined) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new RepositoryError(
          `Error finding admin actions for user ${userId} in server ${serverId}`,
          error
        );
      }

      return data as AdminAction[];
    } catch (error) {
      this.handleError(error as Error, 'findByUserAndServer');
      return [];
    }
  }

  async findByAdmin(
    adminId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AdminAction[]> {
    try {
      let query = this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('admin_id', adminId)
        .order('action_at', { ascending: false });

      if (options.limit !== undefined) {
        query = query.limit(options.limit);
      }
      if (options.offset !== undefined) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new RepositoryError(`Error finding admin actions for admin ${adminId}`, error);
      }

      return data as AdminAction[];
    } catch (error) {
      this.handleError(error as Error, 'findByAdmin');
      return [];
    }
  }

  async findByVerificationEvent(verificationEventId: string): Promise<AdminAction[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('verification_event_id', verificationEventId)
        .order('action_at', { ascending: false });

      if (error) {
        throw new RepositoryError(
          `Error finding admin actions for verification event ${verificationEventId}`,
          error
        );
      }

      return data as AdminAction[];
    } catch (error) {
      this.handleError(error as Error, 'findByVerificationEvent');
      return [];
    }
  }

  async createAction(data: AdminActionCreate): Promise<AdminAction> {
    try {
      const actionData = {
        ...data,
        action_at: new Date().toISOString(),
        metadata: data.metadata || {},
      };

      const { data: createdAction, error } = await this.supabaseClient
        .from(this.tableName)
        .insert(actionData)
        .select()
        .single();

      if (error) {
        throw new RepositoryError('Error creating admin action', error);
      }

      if (!createdAction) {
        throw new RepositoryError('No data returned when creating admin action');
      }

      return createdAction as AdminAction;
    } catch (error) {
      this.handleError(error as Error, 'createAction');
      throw error;
    }
  }

  async getActionHistory(userId: string, serverId: string): Promise<AdminAction[]> {
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }
}
