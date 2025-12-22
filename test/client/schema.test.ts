import { describe, expect, it } from "vitest";
import {
  createSyncConfig,
  generateDexieStores,
  SYNC_INDICES,
  validateSyncTableDef,
  validateSyncTableDefs,
  type SyncTableDef,
} from "../../src/lib/sync/hlc/schema";

describe("Schema Generator", () => {
  describe("generateDexieStores()", () => {
    it("should generate schema with primary key only", () => {
      const tables = {
        simple: {
          primaryKey: "id",
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.simple).toBe(
        "id, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema with auto-increment primary key", () => {
      const tables = {
        autoInc: {
          primaryKey: "id",
          autoIncrement: true,
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.autoInc).toBe(
        "++id, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema with regular indices", () => {
      const tables = {
        indexed: {
          primaryKey: "id",
          indices: ["bookId", "userId", "createdAt"],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.indexed).toBe(
        "id, bookId, userId, createdAt, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema with unique indices", () => {
      const tables = {
        unique: {
          primaryKey: "id",
          uniqueIndices: ["email", "username"],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.unique).toBe(
        "id, &email, &username, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema with compound indices", () => {
      const tables = {
        compound: {
          primaryKey: "id",
          compoundIndices: [
            ["bookId", "userId"],
            ["userId", "createdAt"],
          ],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.compound).toBe(
        "id, [bookId+userId], [userId+createdAt], _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema with mixed index types", () => {
      const tables = {
        mixed: {
          primaryKey: "id",
          autoIncrement: true,
          indices: ["bookId", "createdAt"],
          uniqueIndices: ["slug"],
          compoundIndices: [["bookId", "userId"]],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.mixed).toBe(
        "++id, bookId, createdAt, &slug, [bookId+userId], _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should handle multiple tables", () => {
      const tables = {
        highlights: {
          primaryKey: "id",
          indices: ["bookId"],
        },
        readingProgress: {
          primaryKey: "id",
          indices: ["bookId", "userId"],
          entityKey: "bookId",
        },
        bookmarks: {
          primaryKey: "id",
          autoIncrement: true,
          indices: ["bookId", "position"],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.highlights).toBe(
        "id, bookId, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
      expect(schemas.readingProgress).toBe(
        "id, bookId, userId, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
      expect(schemas.bookmarks).toBe(
        "++id, bookId, position, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should always include sync metadata indices", () => {
      const tables = {
        table1: { primaryKey: "id" },
        table2: { primaryKey: "key", indices: ["name"] },
      };

      const schemas = generateDexieStores(tables);

      for (const schema of Object.values(schemas)) {
        for (const syncIndex of SYNC_INDICES) {
          expect(schema).toContain(syncIndex);
        }
      }
    });

    it("should handle empty indices arrays", () => {
      const tables = {
        empty: {
          primaryKey: "id",
          indices: [],
          uniqueIndices: [],
          compoundIndices: [],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.empty).toBe(
        "id, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should preserve order: primary key, indices, unique, compound, sync metadata", () => {
      const tables = {
        ordered: {
          primaryKey: "id",
          indices: ["a", "b"],
          uniqueIndices: ["c"],
          compoundIndices: [["d", "e"]],
        },
      };

      const schemas = generateDexieStores(tables);
      const parts = schemas.ordered.split(", ");

      expect(parts[0]).toBe("id");
      expect(parts[1]).toBe("a");
      expect(parts[2]).toBe("b");
      expect(parts[3]).toBe("&c");
      expect(parts[4]).toBe("[d+e]");
      expect(parts[5]).toBe("_hlc");
      expect(parts[6]).toBe("_deviceId");
      expect(parts[7]).toBe("_serverTimestamp");
      expect(parts[8]).toBe("_isDeleted");
    });
  });

  describe("validateSyncTableDef()", () => {
    it("should pass validation for valid table definition", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        indices: ["bookId"],
      };

      expect(() => validateSyncTableDef("test", def)).not.toThrow();
    });

    it("should throw error if primaryKey is missing", () => {
      const def = {
        indices: ["bookId"],
      } as unknown as SyncTableDef;

      expect(() => validateSyncTableDef("test", def)).toThrow(
        "primaryKey is required",
      );
    });

    it("should throw error if reserved field name is used in indices", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        indices: ["_hlc", "bookId"],
      };

      expect(() => validateSyncTableDef("test", def)).toThrow(
        'Cannot use reserved field name "_hlc"',
      );
    });

    it("should throw error if reserved field name is used in uniqueIndices", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        uniqueIndices: ["_deviceId"],
      };

      expect(() => validateSyncTableDef("test", def)).toThrow(
        'Cannot use reserved field name "_deviceId"',
      );
    });

    it("should throw error if reserved field name is used in compoundIndices", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        compoundIndices: [["bookId", "_serverTimestamp"]],
      };

      expect(() => validateSyncTableDef("test", def)).toThrow(
        'Cannot use reserved field name "_serverTimestamp"',
      );
    });

    it("should throw error for compound index with less than 2 fields", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        compoundIndices: [["singleField"]],
      };

      expect(() => validateSyncTableDef("test", def)).toThrow(
        "Compound index must have at least 2 fields",
      );
    });

    it("should allow all reserved field names to be protected", () => {
      const reservedFields = [
        "_hlc",
        "_deviceId",
        "_serverTimestamp",
        "_isDeleted",
      ];

      for (const field of reservedFields) {
        const def: SyncTableDef = {
          primaryKey: "id",
          indices: [field],
        };

        expect(() => validateSyncTableDef("test", def)).toThrow(
          `Cannot use reserved field name "${field}"`,
        );
      }
    });

    it("should pass validation for complex valid definition", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        autoIncrement: true,
        indices: ["bookId", "userId", "createdAt"],
        uniqueIndices: ["uuid"],
        compoundIndices: [
          ["bookId", "userId"],
          ["userId", "createdAt", "type"],
        ],
        entityKey: "bookId",
        appendOnly: false,
      };

      expect(() => validateSyncTableDef("test", def)).not.toThrow();
    });
  });

  describe("validateSyncTableDefs()", () => {
    it("should validate all tables", () => {
      const tables = {
        table1: { primaryKey: "id", indices: ["a"] },
        table2: { primaryKey: "key", indices: ["b"] },
      };

      expect(() => validateSyncTableDefs(tables)).not.toThrow();
    });

    it("should throw if any table is invalid", () => {
      const tables = {
        valid: { primaryKey: "id" },
        invalid: { primaryKey: "id", indices: ["_hlc"] },
      };

      expect(() => validateSyncTableDefs(tables)).toThrow();
    });

    it("should provide table name in error message", () => {
      const tables = {
        myTable: { primaryKey: "id", indices: ["_deviceId"] },
      };

      expect(() => validateSyncTableDefs(tables)).toThrow("myTable");
    });

    it("should handle empty table definitions", () => {
      const tables = {};

      expect(() => validateSyncTableDefs(tables)).not.toThrow();
    });
  });

  describe("createSyncConfig()", () => {
    it("should create valid sync config", () => {
      const tables = {
        highlights: { primaryKey: "id", indices: ["bookId"] },
      };

      const config = createSyncConfig(tables);

      expect(config).toEqual({ tables });
    });

    it("should validate tables on creation", () => {
      const tables = {
        invalid: { primaryKey: "id", indices: ["_hlc"] },
      };

      expect(() => createSyncConfig(tables)).toThrow();
    });

    it("should handle multiple tables", () => {
      const tables = {
        highlights: { primaryKey: "id", indices: ["bookId"] },
        progress: { primaryKey: "id", indices: ["userId"] },
        bookmarks: { primaryKey: "id", autoIncrement: true },
      };

      const config = createSyncConfig(tables);

      expect(config.tables).toEqual(tables);
      expect(Object.keys(config.tables)).toHaveLength(3);
    });
  });

  describe("SYNC_INDICES constant", () => {
    it("should contain all required sync metadata fields", () => {
      expect(SYNC_INDICES).toContain("_hlc");
      expect(SYNC_INDICES).toContain("_deviceId");
      expect(SYNC_INDICES).toContain("_serverTimestamp");
      expect(SYNC_INDICES).toContain("_isDeleted");
    });

    it("should have exactly 4 sync indices", () => {
      expect(SYNC_INDICES).toHaveLength(4);
    });

    it("should be readonly", () => {
      // This is a compile-time check, but we can verify the array exists
      expect(Array.isArray(SYNC_INDICES)).toBe(true);
    });
  });

  describe("SyncTableDef interface usage", () => {
    it("should support entityKey for scoped pulls", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        indices: ["bookId", "userId"],
        entityKey: "bookId",
      };

      const schemas = generateDexieStores({ test: def });
      expect(schemas.test).toContain("bookId");
    });

    it("should support appendOnly flag", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        appendOnly: true,
      };

      // appendOnly doesn't affect schema generation, just middleware behavior
      const schemas = generateDexieStores({ test: def });
      expect(schemas.test).toBe(
        "id, _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should support all optional fields", () => {
      const def: SyncTableDef = {
        primaryKey: "id",
        autoIncrement: true,
        indices: ["a"],
        uniqueIndices: ["b"],
        compoundIndices: [["c", "d"]],
        entityKey: "e",
        appendOnly: false,
      };

      expect(() => validateSyncTableDef("test", def)).not.toThrow();
    });
  });

  describe("Real-world schema examples", () => {
    it("should generate schema for highlights table", () => {
      const tables = {
        highlights: {
          primaryKey: "id",
          indices: ["bookId", "createdAt", "color"],
          compoundIndices: [["bookId", "createdAt"]],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.highlights).toBe(
        "id, bookId, createdAt, color, [bookId+createdAt], _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema for reading progress table", () => {
      const tables = {
        readingProgress: {
          primaryKey: "id",
          indices: ["bookId", "userId", "lastReadAt"],
          compoundIndices: [["bookId", "userId"]],
          entityKey: "bookId",
          appendOnly: true,
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.readingProgress).toBe(
        "id, bookId, userId, lastReadAt, [bookId+userId], _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should generate schema for bookmarks table", () => {
      const tables = {
        bookmarks: {
          primaryKey: "id",
          autoIncrement: true,
          indices: ["bookId", "chapterIndex", "position"],
          compoundIndices: [["bookId", "position"]],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(schemas.bookmarks).toBe(
        "++id, bookId, chapterIndex, position, [bookId+position], _hlc, _deviceId, _serverTimestamp, _isDeleted",
      );
    });

    it("should handle complete application schema", () => {
      const tables = {
        highlights: {
          primaryKey: "id",
          indices: ["bookId", "userId"],
        },
        readingProgress: {
          primaryKey: "id",
          indices: ["bookId", "userId"],
          entityKey: "bookId",
          appendOnly: true,
        },
        bookmarks: {
          primaryKey: "id",
          autoIncrement: true,
          indices: ["bookId"],
        },
        annotations: {
          primaryKey: "id",
          indices: ["highlightId", "createdAt"],
          compoundIndices: [["highlightId", "createdAt"]],
        },
      };

      const schemas = generateDexieStores(tables);

      expect(Object.keys(schemas)).toHaveLength(4);
      expect(schemas.highlights).toBeTruthy();
      expect(schemas.readingProgress).toBeTruthy();
      expect(schemas.bookmarks).toBeTruthy();
      expect(schemas.annotations).toBeTruthy();

      // All should have sync metadata
      for (const schema of Object.values(schemas)) {
        expect(schema).toContain("_hlc");
        expect(schema).toContain("_deviceId");
        expect(schema).toContain("_serverTimestamp");
        expect(schema).toContain("_isDeleted");
      }
    });
  });
});
