import { expect, test } from "vitest";
import { distinctLabels } from "../../src/web/data/tab-labels";
test("labels add the shortest parent context only for collisions", () => {
  expect(
    distinctLabels([
      { label: "main", qualifier: "/repos/bun" },
      { label: "main", qualifier: "/repos/med" },
      { label: "feature", qualifier: "/repos/bun" },
    ]),
  ).toEqual(["bun/main", "med/main", "feature"]);
  expect(
    distinctLabels([
      { label: "index.ts", qualifier: "src/a/lib" },
      { label: "index.ts", qualifier: "src/b/lib" },
    ]),
  ).toEqual(["a/lib/index.ts", "b/lib/index.ts"]);
});
