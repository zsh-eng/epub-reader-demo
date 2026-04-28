import type { PaginationEngineJob } from "../engine";
import type { PaginationCommand } from "../protocol";
import {
    coalesceQueuedCommands,
    getCoalesceKey,
    getCommandPriority,
    startsLayoutEpoch,
    type PaginationJobPriority,
    type QueuedPaginationCommand,
} from "./scheduler-policy";

export interface ScheduledPaginationJob {
  coalesceKey: string | null;
  engineJob: PaginationEngineJob;
  eventEpoch: number | null;
  priority: PaginationJobPriority;
  startsLayout: boolean;
}

/**
 * Owns command inbox expansion and prioritized job queues.
 * Jobs stay at the head of their priority queue until done, so layout work can
 * resume naturally after user-priority commands preempt it at yield boundaries.
 */
export class PaginationJobScheduler {
  private incomingCommands: QueuedPaginationCommand[] = [];
  private userJobs: ScheduledPaginationJob[] = [];
  private layoutJobs: ScheduledPaginationJob[] = [];
  private backgroundJobs: ScheduledPaginationJob[] = [];
  private createEngineJob: (
    command: PaginationCommand,
  ) => PaginationEngineJob;

  constructor(
    createEngineJob: (command: PaginationCommand) => PaginationEngineJob,
  ) {
    this.createEngineJob = createEngineJob;
  }

  pushCommand(command: PaginationCommand): void {
    this.incomingCommands.push({ command });
  }

  expandIncomingCommands(): void {
    if (this.incomingCommands.length === 0) return;

    const commands = coalesceQueuedCommands(this.incomingCommands);
    this.incomingCommands = [];

    for (const { command } of commands) {
      this.enqueueCommand(command);
    }
  }

  peek(): ScheduledPaginationJob | null {
    return (
      this.userJobs[0] ??
      this.layoutJobs[0] ??
      this.backgroundJobs[0] ??
      null
    );
  }

  remove(job: ScheduledPaginationJob): void {
    const queue = this.queueForPriority(job.priority);
    if (queue[0] === job) {
      queue.shift();
      return;
    }

    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  }

  hasWork(): boolean {
    return (
      this.incomingCommands.length > 0 ||
      this.userJobs.length > 0 ||
      this.layoutJobs.length > 0 ||
      this.backgroundJobs.length > 0
    );
  }

  private enqueueCommand(command: PaginationCommand): void {
    if (command.type === "init") {
      this.clearJobQueues();
    }

    const coalesceKey = getCoalesceKey(command);
    this.removeSupersededJobs(coalesceKey);

    const priority = getCommandPriority(command);
    const job: ScheduledPaginationJob = {
      coalesceKey,
      engineJob: this.createEngineJob(command),
      eventEpoch: null,
      priority,
      startsLayout: startsLayoutEpoch(command),
    };

    this.queueForPriority(priority).push(job);
  }

  private clearJobQueues(): void {
    this.userJobs = [];
    this.layoutJobs = [];
    this.backgroundJobs = [];
  }

  private removeSupersededJobs(coalesceKey: string | null): void {
    if (!coalesceKey) return;

    const keepJob = (job: ScheduledPaginationJob) =>
      job.coalesceKey !== coalesceKey;
    this.userJobs = this.userJobs.filter(keepJob);
    this.layoutJobs = this.layoutJobs.filter(keepJob);
    this.backgroundJobs = this.backgroundJobs.filter(keepJob);
  }

  private queueForPriority(
    priority: PaginationJobPriority,
  ): ScheduledPaginationJob[] {
    switch (priority) {
      case "user":
        return this.userJobs;
      case "layout":
        return this.layoutJobs;
      case "background":
        return this.backgroundJobs;
    }
  }
}
