/**
 * Schema Generator for Dexie Tables with Sync Metadata
 *
 * This module generates Dexie table schemas that include sync metadata fields.
 * It automatically adds indices for HLC, device ID, server timestamp, and deletion flag.
 */

/**
 * Definition of a table to be synced
 */
export interface SyncTableDef {
  /** Primary key field name */
  primaryKey: string;

  /** Whether the primary key is auto-incremented */
  autoIncrement?: boolean;

  /** Regular indices (single field) */
  indices?: string[];

  /** Unique indices (single field) */
  uniqueIndices?: string[];

  /** Compound indices (multiple fields) */
  compoundIndices?: string[][];

  /**
   * For scoped server pulls (e.g., fetch progress by bookId).
   * This is the field name used to scope queries to a specific entity.
   * Example: 'bookId' for reading progress
   */
  entityKey?: string;

  /**
   * Skip read-before-write optimization for append-only tables.
   * When true, the middleware won't read existing records before writing.
   */
  appendOnly?: boolean;
}

/**
 * Sync metadata indices that are automatically added to all synced tables
 */
export const SYNC_INDICES = [
  "_hlc",
  "_deviceId",
  "_serverTimestamp",
  "_isDeleted",
] as const;

/**
 * Generate Dexie store schema strings from sync table definitions.
 *
 * Each table gets:
 * - Primary key (with ++ if autoIncrement)
 * - User-defined indices
 * - Sync metadata indices (_hlc, _deviceId, _serverTimestamp, _isDeleted)
 *
 * @param tables - Record of table name to table definition
 * @returns Record of table name to Dexie schema string
 *
 * @example
 * ```ts
 * const tables = {
 *   highlights: {
 *     primaryKey: 'id',
 *     indices: ['bookId', 'createdAt'],
 *     compoundIndices: [['bookId', 'createdAt']],
 *   },
 *   readingProgress: {
 *     primaryKey: 'id',
 *     indices: ['bookId', 'userId'],
 *     entityKey: 'bookId',
 *     appendOnly: true,
 *   },
 * };
 *
 * const schemas = generateDexieStores(tables);
 * // {
 * //   highlights: 'id, bookId, createdAt, [bookId+createdAt], _hlc, _deviceId, _serverTimestamp, _isDeleted',
 * //   readingProgress: 'id, bookId, userId, _hlc, _deviceId, _serverTimestamp, _isDeleted'
 * // }
 * ```
 */
export function generateDexieStores(
  tables: Record<string, SyncTableDef>,
): Record<string, string> {
  const schemas: Record<string, string> = {};

  for (const [tableName, def] of Object.entries(tables)) {
    const parts: string[] = [];

    // Primary key
    const pkPrefix = def.autoIncrement ? "++" : "";
    parts.push(`${pkPrefix}${def.primaryKey}`);

    // Regular indices
    if (def.indices && def.indices.length > 0) {
      parts.push(...def.indices);
    }

    // Unique indices
    if (def.uniqueIndices && def.uniqueIndices.length > 0) {
      for (const idx of def.uniqueIndices) {
        parts.push(`&${idx}`);
      }
    }

    // Compound indices
    if (def.compoundIndices && def.compoundIndices.length > 0) {
      for (const compound of def.compoundIndices) {
        parts.push(`[${compound.join("+")}]`);
      }
    }

    // Add sync metadata indices
    parts.push(...SYNC_INDICES);

    schemas[tableName] = parts.join(", ");
  }

  return schemas;
}

/**
 * Type-safe sync metadata fields that are added to all synced records
 */
export interface SyncMetadata {
  /** Hybrid Logical Clock timestamp */
  _hlc: string;

  /** Device ID that created/modified this record */
  _deviceId: string;

  /**
   * Server timestamp when this record was synced to server.
   * null for local-only changes that haven't been synced yet.
   */
  _serverTimestamp: number | null;

  /** Whether this record has been deleted (tombstone) - 0 or 1 for indexing support */
  _isDeleted: 0 | 1;
}

/**
 * Helper type to add sync metadata to a record type
 */
export type WithSyncMetadata<T> = T & SyncMetadata;

/**
 * Validate a sync table definition
 * @throws Error if the definition is invalid
 */
export function validateSyncTableDef(
  tableName: string,
  def: SyncTableDef,
): void {
  if (!def.primaryKey) {
    throw new Error(`Table ${tableName}: primaryKey is required`);
  }

  // Check for reserved field names
  const reservedFields = [
    "_hlc",
    "_deviceId",
    "_serverTimestamp",
    "_isDeleted",
  ];

  const allFields = [
    ...(def.indices || []),
    ...(def.uniqueIndices || []),
    ...(def.compoundIndices || []).flat(),
  ];

  for (const field of allFields) {
    if (reservedFields.includes(field)) {
      throw new Error(
        `Table ${tableName}: Cannot use reserved field name "${field}"`,
      );
    }
  }

  // Validate compound indices
  if (def.compoundIndices) {
    for (const compound of def.compoundIndices) {
      if (compound.length < 2) {
        throw new Error(
          `Table ${tableName}: Compound index must have at least 2 fields`,
        );
      }
    }
  }
}

/**
 * Validate all sync table definitions
 * @throws Error if any definition is invalid
 */
export function validateSyncTableDefs(
  tables: Record<string, SyncTableDef>,
): void {
  for (const [tableName, def] of Object.entries(tables)) {
    validateSyncTableDef(tableName, def);
  }
}

/**
 * Configuration for sync-enabled tables
 */
export interface SyncConfig {
  /** Table definitions */
  tables: Record<string, SyncTableDef>;
}

/**
 * Create a complete sync configuration with validation
 */
export function createSyncConfig(
  tables: Record<string, SyncTableDef>,
): SyncConfig {
  validateSyncTableDefs(tables);
  return { tables };
}
