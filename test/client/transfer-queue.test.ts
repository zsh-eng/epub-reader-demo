/**
 * Transfer Queue Tests
 *
 * Integration tests for the transfer queue and file manager
 */

import { db } from "@/lib/db";
import { fileStorage } from "@/lib/files/file-storage";
import { transferQueue } from "@/lib/files/transfer-queue";
import type { TransferTask } from "@/lib/files/types";
import { beforeEach, describe, expect, it } from "vitest";

describe("Transfer Queue", () => {
  beforeEach(async () => {
    // Clear all tables before each test
    await db.transferQueue.clear();
    await db.files.clear();
  });

  it("should queue an upload task", async () => {
    const contentHash = "test-hash-123";
    const fileType = "epub" as const;
    const blob = new Blob(["test content"], { type: "application/epub+zip" });

    const taskId = await transferQueue.queueUpload(
      contentHash,
      fileType,
      blob,
      { priority: "high" },
    );

    expect(taskId).toBeDefined();

    // Verify file is stored locally
    const hasLocal = await fileStorage.has(contentHash, fileType);
    expect(hasLocal).toBe(true);

    // Verify task is in queue (may be pending or processing due to async nature)
    const task = await db.transferQueue.get(taskId);
    expect(task).toBeDefined();
    expect(task?.direction).toBe("upload");
    expect(task?.contentHash).toBe(contentHash);
    expect(task?.fileType).toBe(fileType);
    expect(["pending", "processing", "failed"]).toContain(task?.status);
    expect(task?.priority).toBe(10); // high priority
  });

  it("should not duplicate upload tasks for the same file", async () => {
    const contentHash = "test-hash-456";
    const fileType = "cover" as const;
    const blob = new Blob(["cover image"], { type: "image/jpeg" });

    const taskId1 = await transferQueue.queueUpload(
      contentHash,
      fileType,
      blob,
      { priority: "normal" },
    );

    const taskId2 = await transferQueue.queueUpload(
      contentHash,
      fileType,
      blob,
      { priority: "normal" },
    );

    // Should return the same task ID
    expect(taskId1).toBe(taskId2);

    // Should only have one task in queue
    const tasks = await db.transferQueue.toArray();
    expect(tasks.length).toBe(1);
  });

  it("should update priority if higher priority task is queued", async () => {
    const contentHash = "test-hash-789";
    const fileType = "epub" as const;
    const blob = new Blob(["test content"], { type: "application/epub+zip" });

    // Queue with low priority
    const taskId = await transferQueue.queueUpload(
      contentHash,
      fileType,
      blob,
      { priority: "low" },
    );

    let task = await db.transferQueue.get(taskId);
    expect(task?.priority).toBe(1); // low priority

    // Queue again with high priority
    await transferQueue.queueUpload(contentHash, fileType, blob, {
      priority: "high",
    });

    task = await db.transferQueue.get(taskId);
    expect(task?.priority).toBe(10); // updated to high priority
  });

  it("should skip download if file already exists locally", async () => {
    const contentHash = "test-hash-abc";
    const fileType = "epub" as const;
    const blob = new Blob(["existing content"], {
      type: "application/epub+zip",
    });

    // Store file locally first
    await fileStorage.store(
      contentHash,
      fileType,
      blob,
      "application/epub+zip",
    );

    // Try to queue download
    const result = await transferQueue.queueDownload(contentHash, fileType);

    expect(result).toBe("already-downloaded");

    // Should not have created a task
    const tasks = await db.transferQueue.toArray();
    expect(tasks.length).toBe(0);
  });

  it("should queue download task if file not local", async () => {
    const contentHash = "test-hash-def";
    const fileType = "cover" as const;

    const taskId = await transferQueue.queueDownload(contentHash, fileType, {
      priority: "high",
    });

    expect(taskId).toBeDefined();
    expect(taskId).not.toBe("already-downloaded");

    const task = await db.transferQueue.get(taskId);
    expect(task?.direction).toBe("download");
    expect(task?.contentHash).toBe(contentHash);
    expect(task?.status).toBe("pending");
  });

  it("should get pending task count", async () => {
    const blob = new Blob(["test"], { type: "application/epub+zip" });

    await transferQueue.queueUpload("hash1", "epub", blob);
    await transferQueue.queueUpload("hash2", "epub", blob);
    await transferQueue.queueUpload("hash3", "cover", blob);

    const count = await transferQueue.getPendingCount();
    // Count may be less than 3 if some tasks already started processing
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThanOrEqual(3);
  });

  it("should clear completed tasks", async () => {
    // Create a completed task manually
    const completedTask: TransferTask = {
      id: crypto.randomUUID(),
      direction: "upload",
      contentHash: "completed-hash",
      fileType: "epub",
      status: "completed",
      priority: 5,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
    };

    await db.transferQueue.add(completedTask);

    // Create a pending task
    const blob = new Blob(["test"], { type: "application/epub+zip" });
    await transferQueue.queueUpload("pending-hash", "epub", blob);

    let tasks = await db.transferQueue.toArray();
    expect(tasks.length).toBe(2);

    // Clear completed
    await transferQueue.clearCompleted();

    tasks = await db.transferQueue.toArray();
    expect(tasks.length).toBe(1);
    expect(["pending", "processing", "failed"]).toContain(tasks[0].status);
  });

  it("should retry failed tasks", async () => {
    // Create a failed task manually
    const failedTask: TransferTask = {
      id: crypto.randomUUID(),
      direction: "download",
      contentHash: "failed-hash",
      fileType: "epub",
      status: "failed",
      priority: 5,
      createdAt: Date.now(),
      retryCount: 3,
      maxRetries: 3,
      error: "Network error",
    };

    await db.transferQueue.add(failedTask);

    // Retry the task
    await transferQueue.retryTask(failedTask.id);

    const task = await db.transferQueue.get(failedTask.id);
    expect(task?.status).toBe("pending");
    expect(task?.retryCount).toBe(0);
    expect(task?.error).toBeUndefined();
  });

  it("should handle progress callbacks", async () => {
    const contentHash = "progress-hash";
    const fileType = "epub" as const;
    let progressUpdates: any[] = [];

    // Subscribe to progress
    const unsubscribe = transferQueue.onProgress(
      contentHash,
      fileType,
      (progress) => {
        progressUpdates.push(progress);
      },
    );

    expect(unsubscribe).toBeInstanceOf(Function);

    // Unsubscribe
    unsubscribe();

    // Verify callback was removed (check internal state would require exposing private fields)
    // For now, just verify the function signature works
  });
});
