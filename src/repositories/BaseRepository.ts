// Remove unused Supabase/Inversify imports for this base file
// import { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
// import { TYPES } from '../di/symbols';
// import { inject, injectable } from 'inversify';

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

// Remove unused AbstractBaseRepository and SupabaseRepository classes

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

// Removed unused AbstractBaseRepository and SupabaseRepository classes
