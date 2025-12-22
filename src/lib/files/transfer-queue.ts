/**
 * Transfer Queue
 *
 * Manages the queue of file upload/download tasks.
 * Handles:
 * - Adding tasks to the queue
 * - Processing tasks with retry logic
 * - Deduplication of tasks
 * - Progress tracking
 */

import { db } from "@/lib/db";
import {
  createHonoFileRemoteAdapter,
  type FileRemoteAdapter,
} from "@/lib/files/file-remote-adapter";
import { fileStorage } from "@/lib/files/file-storage";
import type {
  FileType,
  Priority,
  TransferDirection,
  TransferProgress,
  TransferTask,
} from "@/lib/files/types";
import { createTransferKey, priorityToNumber } from "@/lib/files/types";

/**
 * Options for queuing a transfer
 */
export interface QueueTransferOptions {
  priority?: Priority;
  maxRetries?: number;
  blob?: Blob; // Required for uploads, not needed for downloads
}

/**
 * TransferQueue manages file upload and download tasks
 */
class TransferQueue {
  private remoteAdapter: FileRemoteAdapter;
  private progressCallbacks = new Map<
    string,
    Set<(progress: TransferProgress) => void>
  >();
  private processingTasks = new Set<string>();
  private isProcessing = false;
  private isPaused = false;

  constructor(remoteAdapter: FileRemoteAdapter) {
    this.remoteAdapter = remoteAdapter;
  }

  /**
   * Pause the transfer queue.
   * Stops processing tasks until resume() is called.
   * Useful when user logs out.
   */
  pause(): void {
    this.isPaused = true;
    console.log("[TransferQueue] Paused");
  }

  /**
   * Resume the transfer queue.
   * Resumes processing tasks if there are any pending.
   * Useful when user logs in.
   */
  resume(): void {
    if (!this.isPaused) {
      return;
    }

    this.isPaused = false;
    console.log("[TransferQueue] Resumed");

    // Check if there are pending tasks and start processing
    this.checkAndStartProcessing();
  }

  /**
   * Check if there are pending tasks and start processing if not paused
   */
  private async checkAndStartProcessing(): Promise<void> {
    if (this.isPaused) {
      return;
    }

    const pendingCount = await this.getPendingCount();
    if (pendingCount > 0) {
      this.startProcessing();
    }
  }

  /**
   * Queue a file for upload
   */
  async queueUpload(
    contentHash: string,
    fileType: FileType,
    blob: Blob,
    options: QueueTransferOptions = {},
  ): Promise<string> {
    if (!blob) {
      throw new Error("Blob is required for upload tasks");
    }

    // Store the file locally first
    const mediaType = blob.type || "application/octet-stream";
    await fileStorage.store(contentHash, fileType, blob, mediaType);

    return this.queueTransfer("upload", contentHash, fileType, options);
  }

  /**
   * Queue a file for download
   */
  async queueDownload(
    contentHash: string,
    fileType: FileType,
    options: QueueTransferOptions = {},
  ): Promise<string> {
    // Check if already downloaded
    const hasLocal = await fileStorage.has(contentHash, fileType);
    if (hasLocal) {
      return "already-downloaded";
    }

    return this.queueTransfer("download", contentHash, fileType, options);
  }

  /**
   * Queue a transfer task
   */
  private async queueTransfer(
    direction: TransferDirection,
    contentHash: string,
    fileType: FileType,
    options: QueueTransferOptions = {},
  ): Promise<string> {
    const { priority = "normal", maxRetries = 3 } = options;

    // Check for existing task
    const existingTask = await this.findExistingTask(
      direction,
      contentHash,
      fileType,
    );

    if (existingTask) {
      // Update priority if higher
      const newPriority = priorityToNumber(priority);
      if (newPriority > existingTask.priority) {
        await db.transferQueue.update(existingTask.id, {
          priority: newPriority,
        });
      }
      return existingTask.id;
    }

    // Create new task
    const task: TransferTask = {
      id: crypto.randomUUID(),
      direction,
      contentHash,
      fileType,
      status: "pending",
      priority: priorityToNumber(priority),
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries,
    };

    await db.transferQueue.add(task);

    // Start processing if not already running
    this.startProcessing();

    return task.id;
  }

  /**
   * Find an existing task for the same file
   */
  private async findExistingTask(
    direction: TransferDirection,
    contentHash: string,
    fileType: FileType,
  ): Promise<TransferTask | undefined> {
    return db.transferQueue
      .where("[contentHash+fileType+direction]")
      .equals([contentHash, fileType, direction])
      .and((task) => task.status !== "completed" && task.status !== "failed")
      .first();
  }

  /**
   * Start processing the queue
   */
  private startProcessing(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.processQueue().catch((error) => {
      console.error("Error processing transfer queue:", error);
      this.isProcessing = false;
    });
  }

  /**
   * Process tasks in the queue
   */
  private async processQueue(): Promise<void> {
    while (true) {
      // Check if paused
      if (this.isPaused) {
        console.log("[TransferQueue] Processing paused");
        this.isProcessing = false;
        return;
      }

      // Get next pending task (highest priority first)
      const task = await db.transferQueue
        .where("status")
        .equals("pending")
        .sortBy("priority");

      const nextTask = task.reverse()[0]; // Highest priority first

      if (!nextTask) {
        // No more pending tasks
        this.isProcessing = false;
        return;
      }

      // Skip if already processing this task
      const taskKey = createTransferKey(
        nextTask.direction,
        nextTask.contentHash,
        nextTask.fileType,
      );

      if (this.processingTasks.has(taskKey)) {
        continue;
      }

      // Mark as processing
      this.processingTasks.add(taskKey);
      await db.transferQueue.update(nextTask.id, {
        status: "processing",
        lastAttempt: Date.now(),
      });

      try {
        // Process the task
        if (nextTask.direction === "upload") {
          await this.processUpload(nextTask);
        } else {
          await this.processDownload(nextTask);
        }

        // Mark as completed
        await db.transferQueue.update(nextTask.id, {
          status: "completed",
        });

        this.notifyProgress({
          contentHash: nextTask.contentHash,
          fileType: nextTask.fileType,
          status: "completed",
        });
      } catch (error) {
        console.error("Transfer task failed:", error);

        // Handle retry logic
        const shouldRetry = nextTask.retryCount < nextTask.maxRetries;

        if (shouldRetry) {
          await db.transferQueue.update(nextTask.id, {
            status: "pending",
            retryCount: nextTask.retryCount + 1,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        } else {
          await db.transferQueue.update(nextTask.id, {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });

          this.notifyProgress({
            contentHash: nextTask.contentHash,
            fileType: nextTask.fileType,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        this.processingTasks.delete(taskKey);
      }
    }
  }

  /**
   * Process an upload task
   */
  private async processUpload(task: TransferTask): Promise<void> {
    // Get the file from local storage
    const file = await fileStorage.get(task.contentHash, task.fileType);
    if (!file) {
      throw new Error(
        `File not found in local storage: ${task.fileType}:${task.contentHash}`,
      );
    }

    // Upload to server via adapter
    await this.remoteAdapter.uploadFile(
      task.contentHash,
      task.fileType,
      file.blob,
    );
  }

  /**
   * Process a download task
   */
  private async processDownload(task: TransferTask): Promise<void> {
    // Download from server via adapter
    const { blob, mediaType } = await this.remoteAdapter.downloadFile(
      task.contentHash,
      task.fileType,
    );

    // Store locally
    await fileStorage.store(task.contentHash, task.fileType, blob, mediaType);
  }

  /**
   * Subscribe to progress updates for a specific file
   */
  onProgress(
    contentHash: string,
    fileType: FileType,
    callback: (progress: TransferProgress) => void,
  ): () => void {
    const key = createTransferKey("upload", contentHash, fileType); // Direction doesn't matter for callback key

    if (!this.progressCallbacks.has(key)) {
      this.progressCallbacks.set(key, new Set());
    }

    this.progressCallbacks.get(key)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.progressCallbacks.get(key);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.progressCallbacks.delete(key);
        }
      }
    };
  }

  /**
   * Notify progress callbacks
   */
  private notifyProgress(progress: TransferProgress): void {
    const uploadKey = createTransferKey(
      "upload",
      progress.contentHash,
      progress.fileType,
    );
    const downloadKey = createTransferKey(
      "download",
      progress.contentHash,
      progress.fileType,
    );

    // Notify both upload and download callbacks
    for (const key of [uploadKey, downloadKey]) {
      const callbacks = this.progressCallbacks.get(key);
      if (callbacks) {
        callbacks.forEach((callback) => callback(progress));
      }
    }
  }

  /**
   * Get pending task count
   */
  async getPendingCount(): Promise<number> {
    return db.transferQueue.where("status").equals("pending").count();
  }

  /**
   * Get all tasks (for debugging)
   */
  async getAllTasks(): Promise<TransferTask[]> {
    return db.transferQueue.toArray();
  }

  /**
   * Clear completed tasks
   */
  async clearCompleted(): Promise<void> {
    await db.transferQueue.where("status").equals("completed").delete();
  }

  /**
   * Retry a failed task
   */
  async retryTask(taskId: string): Promise<void> {
    const task = await db.transferQueue.get(taskId);
    if (!task || task.status !== "failed") {
      return;
    }

    await db.transferQueue.update(taskId, {
      status: "pending",
      retryCount: 0,
      error: undefined,
    });

    this.startProcessing();
  }
}

// Export singleton instance with Hono adapter
export const transferQueue = new TransferQueue(createHonoFileRemoteAdapter());

// Export class for testing
export { TransferQueue };
