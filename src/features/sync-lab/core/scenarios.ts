import type { SyncLabController } from "./controller";

/** Built-in sequences use the same writes and transport controls as manual inspection. */
export async function runLabScenario(
  controller: SyncLabController,
  selectedBook: string,
  kind: "conflict" | "lost-response" | "deletion",
) {
  const view = controller.getSnapshot();
  const [a, b] = view.clients;
  if (!a || !b || !selectedBook)
    throw new Error("Start two clients and select a book.");
  for (const client of view.clients) controller.setAutoSync(client.id, false);
  controller.log("Lab", "scenario", `Started ${kind} scenario`);
  // Bootstrap first so empty clients can join the same scenario.
  controller.setOnline(a.id, true);
  controller.setOnline(b.id, true);
  await controller.command(a.id, { type: "sync" });
  await controller.command(b.id, { type: "sync" });
  if (kind === "conflict") {
    controller.setOnline(a.id, false);
    controller.setOnline(b.id, false);
    await controller.command(a.id, {
      type: "note",
      bookId: selectedBook,
      content: "Written offline on Client A",
    });
    await controller.command(b.id, {
      type: "note",
      bookId: selectedBook,
      content: "Written offline on Client B",
    });
  } else {
    await controller.command(a.id, {
      type: "note",
      bookId: selectedBook,
      content: "A note that survives a lost response",
    });
    if (kind === "lost-response") {
      controller.configure(a.id, { failure: "response" });
      try {
        await controller.command(a.id, { type: "push" });
      } catch {
        /* Intentional fault; the next sync must recover. */
      }
    } else {
      await controller.command(a.id, { type: "sync" });
      await controller.command(b.id, { type: "sync" });
      await controller.command(a.id, {
        type: "delete-note",
        bookId: selectedBook,
      });
    }
  }
  controller.setOnline(a.id, true);
  controller.setOnline(b.id, true);
  await controller.command(a.id, { type: "sync" });
  await controller.command(b.id, { type: "sync" });
  await controller.command(a.id, { type: "sync" });
  const states = controller
    .getSnapshot()
    .clients.slice(0, 2)
    .map((client) =>
      client.inspection?.rows.notes?.find(
        (note) => note.id === `lab-note:${selectedBook}`,
      ),
    );
  if (!states[0] || JSON.stringify(states[0]) !== JSON.stringify(states[1]))
    throw new Error(
      "Scenario did not converge. Inspect the two note records and event timeline.",
    );
  controller.log("Lab", "scenario", `${kind}: both clients agree`, states[0]);
}
