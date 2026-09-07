import type { LabSnapshot, SyncLabController } from "./controller";
import type { PlaybackPlan, PlaybackStep } from "./playback";
import { waitForLabClients } from "./client-readiness";

export const LAB_SCENARIOS = [
  {
    id: "offline-edit",
    name: "Offline note",
    result: "A saves offline. B receives the note after reconnection.",
  },
  {
    id: "conflict",
    name: "Offline note conflict",
    result: "Both edit the same note. The later version wins.",
  },
  {
    id: "lost-response",
    name: "Lost write response",
    result:
      "The server commits the write. Retrying clears the outbox without a duplicate.",
  },
  {
    id: "deletion",
    name: "Delete across devices",
    result: "A deletes a shared note. B receives the tombstone.",
  },
  {
    id: "handoff",
    name: "Newer reading position",
    result:
      "Open Reader A after setup. Playback offers B’s newer position without moving A.",
  },
  {
    id: "clock-skew",
    name: "Clock ahead",
    result:
      "A future timestamp is rejected. The pending write succeeds after clocks catch up.",
  },
] as const;
export type ScenarioKind = (typeof LAB_SCENARIOS)[number]["id"];

/** Set up an inspectable state, then expose each transport decision as one playback step. */
export function createLabScenario(
  controller: SyncLabController,
  bookId: string,
  kind: ScenarioKind,
): PlaybackPlan {
  const [a, b] = controller.getSnapshot().clients;
  if (!a || !b || !bookId)
    throw new Error("Start two clients and select a book.");
  const recipe = LAB_SCENARIOS.find((item) => item.id === kind)!;
  const noteId = `lab-note:${bookId}`;
  let baseline: LabSnapshot | undefined;
  const steps: PlaybackStep[] = [];
  const add = (
    label: string,
    run: () => void | Promise<void>,
    pauseAfter = false,
  ) => {
    steps.push({
      label,
      run: async () => {
        await run();
        controller.log("Lab", "step", label);
      },
      pauseAfter,
    });
  };
  const command = (id: string, type: "push" | "pull" | "sync") =>
    controller.command(id, { type });
  const note = (id: string, content: string) =>
    controller.command(id, { type: "note", bookId, content });
  const inspectNote = () =>
    controller
      .getSnapshot()
      .clients.filter((client) => client.id === a.id || client.id === b.id)
      .map((client) =>
        client.inspection?.rows.notes?.find((row) => row.id === noteId),
      );
  const expected =
    kind === "conflict" ? "Written offline on Client B" : "Written on Client A";
  const checkNote = () => {
    const rows = inspectNote();
    if (
      rows.length !== 2 ||
      rows.some(
        (row) =>
          !row ||
          (kind === "deletion"
            ? !row.isDeleted
            : row.isDeleted || row.content !== expected),
      )
    )
      throw new Error(
        "The note differs from the scenario result. Inspect Records; paused edits may change the outcome.",
      );
    if (JSON.stringify(rows[0]) !== JSON.stringify(rows[1]))
      throw new Error("The two note records have not converged.");
    if (
      controller
        .getSnapshot()
        .clients.filter((client) => client.id === a.id || client.id === b.id)
        .some((client) => client.inspection?.outbox.length)
    )
      throw new Error("Client writes are still pending. Inspect the outbox.");
  };
  if (kind === "handoff") {
    add("B · Read to 65% of chapter 1", () =>
      controller.command(b.id, { type: "checkpoint", bookId, progress: 65 }),
    );
    add("B → Server · Push position", () => command(b.id, "push"));
    add(
      "Server → A · Pull newer position; inspect Reader",
      () => command(a.id, "pull"),
      true,
    );
    add("Verify A received B’s position", () => {
      const rows = controller
        .getSnapshot()
        .clients.find((client) => client.id === a.id)?.inspection
        ?.rows.readingCheckpoints;
      if (
        !rows?.some((row) => row.deviceId === b.id && row.scrollProgress === 65)
      )
        throw new Error("A has not received B’s reading position.");
    });
  } else {
    if (kind === "lost-response") {
      add(
        "A → Server · Commit write, lose response",
        async () => {
          try {
            await command(a.id, "push");
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "Response lost after server commit"
            )
              return;
            throw error;
          }
          throw new Error("Expected a lost write response.");
        },
        true,
      );
    } else if (kind === "clock-skew") {
      add(
        "A → Server · Reject future timestamp",
        async () => {
          try {
            await command(a.id, "push");
          } catch (error) {
            if (error instanceof Error && error.message.includes("future"))
              return;
            throw error;
          }
          throw new Error("Expected a future-clock rejection.");
        },
        true,
      );
      add("Reset A’s offset; advance sync clocks 6 minutes", () => {
        controller.configure(a.id, { clockOffset: 0 });
        controller.advanceClock(360_000);
      });
    } else {
      add("A · Reconnect", () => controller.setOnline(a.id, true));
    }
    add("A → Server · Push pending note", () => command(a.id, "push"));
    add("B · Reconnect", () => controller.setOnline(b.id, true));
    add("Server → B · Pull note", () => command(b.id, "pull"));
    add("B → Server · Push local changes", () => command(b.id, "push"));
    add("Server → A · Pull resolved note", () => command(a.id, "pull"));
    add("Verify note and empty outboxes", checkNote);
  }
  return {
    name: recipe.name,
    steps,
    async prepare() {
      if (baseline) {
        await controller.restore(baseline);
        await waitForLabClients(controller, [a.id, b.id]);
        return;
      }
      for (const client of controller.getSnapshot().clients)
        controller.setAutoSync(client.id, false);
      controller.setOnline(a.id, true);
      controller.setOnline(b.id, true);
      await command(a.id, "sync");
      await command(b.id, "sync");
      await command(a.id, "sync");
      if (kind === "handoff") {
        await controller.command(a.id, { type: "download", bookId });
        await controller.command(a.id, {
          type: "checkpoint",
          bookId,
          progress: 15,
        });
        await command(a.id, "push");
        await command(b.id, "pull");
      } else {
        await note(a.id, "Initial shared note");
        await command(a.id, "push");
        await command(b.id, "pull");
        if (kind === "clock-skew")
          controller.configure(a.id, { clockOffset: 360_000 });
        if (
          kind === "offline-edit" ||
          kind === "conflict" ||
          kind === "deletion"
        )
          controller.setOnline(a.id, false);
        if (kind === "deletion")
          await controller.command(a.id, { type: "delete-note", bookId });
        else await note(a.id, "Written on Client A");
        if (kind === "conflict") {
          controller.setOnline(b.id, false);
          controller.advanceClock(1000);
          await note(b.id, expected);
        }
        if (kind === "lost-response")
          controller.configure(a.id, { failure: "response" });
      }
      baseline = await controller.checkpoint(`${recipe.name} · start`);
      await waitForLabClients(controller, [a.id, b.id]);
      controller.log("Lab", "scenario", `Prepared ${recipe.name}`);
    },
    complete() {
      controller.log(
        "Lab",
        "scenario",
        kind === "handoff"
          ? "handoff: newer position received"
          : `${kind}: both clients agree`,
      );
    },
  };
}
