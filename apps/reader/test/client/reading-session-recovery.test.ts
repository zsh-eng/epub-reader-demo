import { ReaderReadingSessionController } from "@/features/reader/hooks/reading-sessions/reader-reading-session-controller";
import { db, updateCurrentDeviceReadingSession } from "@/lib/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
const position = { bookId: "book", currentSpineIndex: 0, scrollProgress: 0 };
it("retries an unchanged failed snapshot on an ordinary flush and persists it", async () => {
  const persist = vi
    .fn(updateCurrentDeviceReadingSession)
    .mockRejectedValueOnce(new Error("Storage unavailable"));
  const onError = vi.fn();
  const controller = new ReaderReadingSessionController({
    persist,
    onError,
    createId: () => "retry-session",
  });
  controller.setPosition(position, { now: 100 });
  controller.flushLatest();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  controller.flushLatest();
  await vi.waitFor(async () =>
    expect(await db.readingSessions.get("retry-session")).toMatchObject({
      bookId: "book",
      startedAt: 100,
    }),
  );
  expect(persist).toHaveBeenCalledTimes(2);
  expect(await db._sync_outbox.count()).toBe(1);
});
it("keeps a newer queued snapshot protected when an older write fails", async () => {
  const older = Promise.withResolvers<string>();
  const newer = Promise.withResolvers<string>();
  const persist = vi
    .fn(updateCurrentDeviceReadingSession)
    .mockImplementationOnce(() => older.promise)
    .mockImplementationOnce(async (snapshot) => {
      await newer.promise;
      return updateCurrentDeviceReadingSession(snapshot);
    });
  const onError = vi.fn();
  const controller = new ReaderReadingSessionController({
    persist,
    onError,
    createId: () => "race-session",
  });
  controller.setPosition(position, { now: 100 });
  controller.flushLatest();
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
  controller.setPosition({ ...position, scrollProgress: 50 }, { now: 100 });
  controller.flushLatest();
  older.reject(new Error("Old write failed"));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  controller.flushLatest();
  newer.resolve("race-session");
  await vi.waitFor(async () =>
    expect(await db.readingSessions.get("race-session")).toMatchObject({
      endScrollProgress: 50,
    }),
  );
  expect(persist).toHaveBeenCalledTimes(2);
});
