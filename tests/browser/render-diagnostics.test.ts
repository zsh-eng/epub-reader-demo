import { expect, test } from "vitest";
import { createRenderDiagnostics } from "../../src/web/data/render-diagnostics";

test("captures Pierre's handled shadow-DOM error with bounded local history", () => {
  sessionStorage.removeItem("med:render-error");
  const diagnostics = createRenderDiagnostics();
  for (let index = 0; index < 100; index++) diagnostics.record("comparison", { index });
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const error = document.createElement("div");
  error.dataset.errorMessage = "";
  error.textContent =
    "VirtualizedFileDiff.render: rendered a different diff than its prepared layout";
  shadow.append(error);
  diagnostics.rendered(host, { review: "revision-a", path: "example.ts" });
  const report = JSON.parse(sessionStorage.getItem("med:render-error")!);
  expect(report.events).toHaveLength(80);
  expect(report.events.at(-1)).toMatchObject({
    event: "render-error",
    detail: { review: "revision-a", path: "example.ts", message: error.textContent },
  });
  sessionStorage.removeItem("med:render-error");
});
