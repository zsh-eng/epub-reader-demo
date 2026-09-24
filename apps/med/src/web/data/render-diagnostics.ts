// Local metadata only. Never retain source text, search queries, or URL tokens.
export function createRenderDiagnostics() {
  const events: { at: number; event: string; detail: Record<string, unknown> }[] = [];
  const failures = new WeakMap<HTMLElement, string>();
  const record = (event: string, detail: Record<string, unknown>) => {
    events.push({ at: Date.now(), event, detail });
    if (events.length > 80) events.shift();
  };
  return {
    record,
    rendered(node: HTMLElement, detail: Record<string, unknown>, renderer?: object) {
      const root = node.shadowRoot ?? node;
      const message = root.querySelector("[data-error-message]")?.textContent;
      record("render", detail);
      if (!message) {
        failures.delete(node);
        return;
      }
      if (message === failures.get(node)) return;
      failures.set(node, message);
      // Optional read-only snapshots of Pierre 1.4.x internals. Keep diagnostics
      // useful if these fields disappear in a future release; do not modify them.
      const field = (object: unknown, key: string): unknown =>
        object && typeof object === "object" ? Reflect.get(object, key) : undefined;
      const prepared = field(field(renderer, "pendingRender"), "diff");
      const rendered = field(renderer, "renderedDiff");
      const metadata = (diff: unknown) => ({
        name: field(diff, "name"),
        cacheKey: field(diff, "cacheKey"),
        hunks: field(field(diff, "hunks"), "length"),
      });
      record("render-error", {
        ...detail,
        message: message.slice(0, 1000),
        prepared: metadata(prepared),
        rendered: metadata(rendered),
        sameObject: prepared === rendered,
      });
      try {
        sessionStorage.setItem("med:render-error", JSON.stringify({ pierre: "1.4.3", events }));
      } catch {
        /* Diagnostics must not interrupt rendering. */
      }
    },
    download() {
      let previous: unknown;
      try {
        previous = JSON.parse(sessionStorage.getItem("med:render-error") ?? "null");
      } catch {
        /* Optional. */
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify({ pierre: "1.4.3", events, lastFailure: previous }, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "med-render-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
