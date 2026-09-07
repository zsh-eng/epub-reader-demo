import { expect, test } from "bun:test";
import { PromiseRateLimiterQueue } from "./promise-limiter";

test("queue respects concurrency, drains safely, and accepts later work", async () => {
  const queue = new PromiseRateLimiterQueue(2);
  let active = 0;
  let maximum = 0;
  const releases: (() => void)[] = [];
  const task = () =>
    queue.add(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
    });
  const first = task();
  const second = task();
  const third = task();
  expect(active).toBe(2);
  releases.shift()!();
  await first;
  expect(active).toBe(2);
  releases.shift()!();
  releases.shift()!();
  await Promise.all([second, third]);
  expect(maximum).toBe(2);
  expect(await queue.add(async () => "after drain")).toBe("after drain");
  await expect(
    queue.add(async () => {
      throw new Error("Rejected task");
    }),
  ).rejects.toThrow("Rejected task");
  expect(await queue.add(async () => "after rejection")).toBe(
    "after rejection",
  );
});
