import { PostgrestError } from '@supabase/supabase-js';
import { AbstractBaseRepository } from './BaseRepository';
import { supabase } from '../config/supabase';

/**
 * Base error class for Supabase repository operations
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/**
 * Specific Supabase implementation of the BaseRepository
 */
export class SupabaseRepository<T extends { id: ID }, ID = string> extends AbstractBaseRepository<
  T,
  ID
> {
  /**
   * Create a new Supabase repository
   * @param tableName The name of the table in Supabase
   */
  constructor(tableName: string) {
    super(tableName);
  }

  /**
   * Handle errors from Supabase operations
   */
  protected handleError(error: PostgrestError | Error, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if ('code' in error) {
      // This is a PostgrestError
      throw new RepositoryError(`Database error during ${operation}: ${error.message}`, error);
    }

    throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
  }

  /**
   * Find an entity by its ID
   */
  async findById(id: ID): Promise<T | null> {
    try {
      const { data, error } = await supabase.from(this.tableName).select('*').eq('id', id).single();

      if (error) throw error;
      return (data as T) || null;
    } catch (error) {
      this.handleError(error as PostgrestError | Error, 'findById');
    }
  }

  /**
   * Find entities by filter criteria
   */
  async findMany(filter: Partial<T> = {}): Promise<T[]> {
    try {
      let query = supabase.from(this.tableName).select('*');

      // Apply filters
      Object.entries(filter).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });

      const { data, error } = await query;

      if (error) throw error;
      return (data as T[]) || [];
    } catch (error) {
      this.handleError(error as PostgrestError | Error, 'findMany');
    }
  }

  /**
   * Create a new entity
   */
  async create(data: Partial<T>): Promise<T> {
    try {
      const { data: created, error } = await supabase
        .from(this.tableName)
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      if (!created) throw new Error('Failed to create entity: No data returned');

      return created as T;
    } catch (error) {
      this.handleError(error as PostgrestError | Error, 'create');
    }
  }

  /**
   * Update an existing entity
   */
  async update(id: ID, data: Partial<T>): Promise<T | null> {
    try {
      const { data: updated, error } = await supabase
        .from(this.tableName)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return (updated as T) || null;
    } catch (error) {
      this.handleError(error as PostgrestError | Error, 'update');
    }
  }

  /**
   * Delete an entity by ID
   */
  async delete(id: ID): Promise<boolean> {
    try {
      const { error } = await supabase.from(this.tableName).delete().eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      this.handleError(error as PostgrestError | Error, 'delete');
    }
  }

  /**
   * Count entities matching the filter
   */
  async count(filter: Partial<T> = {}): Promise<number> {
    try {
      let query = supabase.from(this.tableName).select('*', { count: 'exact', head: true });

      // Apply filters
      Object.entries(filter).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });

      const { count, error } = await query;

      if (error) throw error;
      return count || 0;
    } catch (error) {
      this.handleError(error as PostgrestError | Error, 'count');
    }
  }
}
