/** Wait for fresh frame endpoints after a checkpoint or restore, with a bounded lifetime. */
export function waitForLabClients(
  controller: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): {
      clients: { id: string; endpoint?: unknown; busy: boolean }[];
    };
  },
  ids: string[],
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new Error("Sequence was disposed"));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Clients did not become ready for replay within the time limit",
          ),
        ),
      timeoutMs,
    );
    const check = () => {
      const clients = controller.getSnapshot().clients;
      if (
        ids.every((id) =>
          clients.some(
            (client) => client.id === id && client.endpoint && !client.busy,
          ),
        )
      )
        finish();
    };
    unsubscribe = controller.subscribe(check);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    else check();
  });
}
