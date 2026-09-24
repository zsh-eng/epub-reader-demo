import { expect, test } from "vitest";
import { relativeTime } from "../src/web/data/relative-time";

const now = Date.parse("2026-09-24T10:00:00Z");
const minute = 60_000;
const day = 24 * 60 * minute;
test.each([
  [0, "just now"],
  [minute - 1, "just now"],
  [minute, "1 min ago"],
  [59 * minute, "59 min ago"],
  [60 * minute, "1 hr ago"],
  [day, "1 day ago"],
  [29 * day, "29 days ago"],
  [30 * day, "1 mo ago"],
  [365 * day, "1 yr ago"],
  [730 * day, "2 yr ago"],
  [-minute, "in 1 min"],
])("formats an elapsed time of %i ms as %s", (elapsed, label) => {
  expect(relativeTime(now - elapsed, now)).toBe(label);
});
