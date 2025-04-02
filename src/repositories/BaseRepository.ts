import { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../di/symbols';
import { inject, injectable } from 'inversify';

/**
 * Generic base repository interface that defines common CRUD operations
 * All specific repositories should implement this interface
 */
export interface IBaseRepository<T, ID = string> {
  /**
   * Find a single entity by its ID
   * @param id The entity ID
   * @returns The entity or null if not found
   */
  findById(id: ID): Promise<T | null>;

  /**
   * Find all entities matching the given filter criteria
   * @param filter Object containing filter criteria
   * @returns Array of matching entities
   */
  findMany(filter?: Partial<T>): Promise<T[]>;

  /**
   * Create a new entity
   * @param data The entity data to create
   * @returns The created entity
   */
  create(data: Partial<T>): Promise<T>;

  /**
   * Update an existing entity
   * @param id The entity ID
   * @param data The data to update
   * @returns The updated entity
   */
  update(id: ID, data: Partial<T>): Promise<T | null>;

  /**
   * Delete an entity by ID
   * @param id The entity ID
   * @returns Boolean indicating success
   */
  delete(id: ID): Promise<boolean>;

  /**
   * Count entities matching the given filter criteria
   * @param filter Object containing filter criteria
   * @returns Count of matching entities
   */
  count(filter?: Partial<T>): Promise<number>;
}

/**
 * Abstract base repository class with common functionality
 * Concrete repositories will extend this class
 */
@injectable()
export abstract class AbstractBaseRepository<T, ID = string> implements IBaseRepository<T, ID> {
  /**
   * The name of the table/collection in the database
   */
  protected readonly tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  abstract findById(id: ID): Promise<T | null>;
  abstract findMany(filter?: Partial<T>): Promise<T[]>;
  abstract create(data: Partial<T>): Promise<T>;
  abstract update(id: ID, data: Partial<T>): Promise<T | null>;
  abstract delete(id: ID): Promise<boolean>;
  abstract count(filter?: Partial<T>): Promise<number>;
}

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
@injectable()
export class SupabaseRepository<T, ID = string> extends AbstractBaseRepository<T, ID> {
  /**
   * Create a new Supabase repository
   * @param tableName The name of the table in Supabase
   * @param supabaseClient The Supabase client instance
   */
  constructor(
    protected tableName: string,
    @inject(TYPES.SupabaseClient) protected supabaseClient: SupabaseClient
  ) {
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
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
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
      let query = this.supabaseClient.from(this.tableName).select('*');

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
      const { data: created, error } = await this.supabaseClient
        .from(this.tableName)
        .insert(data)
        .select()
        .single();

      // Handle the specific "no rows" error
      if (error && error.code === 'PGRST116') {
        throw new Error('Failed to create entity: No data returned');
      } else if (error) {
        throw error;
      }
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
      const { data: updated, error } = await this.supabaseClient
        .from(this.tableName)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
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
      const { error } = await this.supabaseClient.from(this.tableName).delete().eq('id', id);

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
      let query = this.supabaseClient
        .from(this.tableName)
        .select('*', { count: 'exact', head: true });

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
