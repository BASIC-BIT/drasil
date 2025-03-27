/**
 * Generic base repository interface that defines common CRUD operations
 * All specific repositories should implement this interface
 */
export interface BaseRepository<T, ID> {
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
}

/**
 * Abstract base repository class with common functionality
 * Concrete repositories will extend this class
 */
export abstract class AbstractBaseRepository<T, ID> implements BaseRepository<T, ID> {
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
}
