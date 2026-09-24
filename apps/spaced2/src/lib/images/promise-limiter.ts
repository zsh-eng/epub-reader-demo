/**
 * Implementation of a queue based promise rate limiter.
 * The rate limiting strategy is a fixed limit on the number of promises that can be executed concurrently.
 *
 * `add` immediately returns a promise that will resolve when the task is finished.
 * The promises are guaranteed to be executed in the order that `add` is called.
 */
export class PromiseRateLimiterQueue {
  private queue: (() => Promise<unknown>)[] = [];
  private limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Limit must be positive");
    }

    this.limit = limit;
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrapped = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.limit++;
          this.executeNext();
        }
      };

      this.queue.push(wrapped);
      this.executeNext();
    });
  }

  /**
   * Executes the next task in the queue.
   * If the current limit is reached, the function doesn't do anything.
   */
  private executeNext() {
    if (this.limit < 0) {
      throw new Error("SHOULD NOT HAPPEN: limit is negative");
    }

    if (this.limit === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;
    // Limit should be decremented before starting the task
    // If we do it in the task, there is a chance that multiple tasks
    // will get started before the limit is decremented
    this.limit--;
    task();
  }
}
