import { expect, test } from "bun:test";

for (const zone of ["UTC", "Asia/Singapore", "America/Los_Angeles"]) {
  test(`study days use calendar dates in ${zone}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      import { strict as assert } from "node:assert";
      import { studyDayKey, studyDayDate, addStudyDays, addStudyMonths, isInStudyRange, nextStudyDayStart } from "./src/lib/study-day.ts";
      for (const [year, month, day, previous] of [
        [2026, 0, 1, "2025-12-31"], [2026, 2, 1, "2026-02-28"],
        [2026, 2, 8, "2026-03-07"], [2026, 10, 1, "2026-10-31"],
      ]) {
        const current = addStudyDays(previous, 1);
        for (const hour of [0, 3]) assert.equal(studyDayKey(new Date(year, month, day, hour, 59)), previous);
        assert.equal(studyDayKey(new Date(year, month, day, 4)), current);
        assert.equal(studyDayKey(new Date(year, month, day, 23, 59)), current);
        assert.equal(nextStudyDayStart(new Date(year, month, day, 3, 59)), new Date(year, month, day, 4).getTime());
        assert.equal(nextStudyDayStart(new Date(year, month, day, 4)), new Date(year, month, day + 1, 4).getTime());
        assert.equal(studyDayDate(current).getDate(), day);
      }
      assert.equal(addStudyMonths("2026-05-31", -3), "2026-02-28");
      assert.equal(addStudyMonths("2024-02-29", -12), "2023-02-28");
      assert.equal(addStudyDays("2026-03-08", 1), "2026-03-09");
      assert.equal(addStudyDays("2026-11-01", 1), "2026-11-02");
      assert.equal(isInStudyRange(new Date(2026, 5, 13, 4), "2026-06-13", "2026-09-13"), true);
      assert.equal(isInStudyRange(new Date(2026, 5, 13, 3, 59), "2026-06-13", "2026-09-13"), false);
      assert.equal(isInStudyRange(new Date(2026, 8, 14, 3, 59), "2026-06-13", "2026-09-13"), true);
      assert.equal(isInStudyRange(new Date(2026, 8, 14, 4), "2026-06-13", "2026-09-13"), false);
    `,
      ],
      { cwd: process.cwd(), env: { ...process.env, TZ: zone } },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
}
