import { expect, test } from "bun:test";
import MemoryDB from "@/lib/db/memory";
import { db } from "@/lib/db/persistence";
import {
  createNewCard,
  createNewDeck,
  updateCardContentOperation,
} from "./operation";

// Dexie table hooks fail inside the real transaction, after operations have
// been written but before the pending queue can commit.
async function rejectPendingWrite(action: () => Promise<unknown>) {
  const reject = () => {
    throw new Error("Pending queue unavailable");
  };
  db.pendingOperations.hook("creating", reject);
  try {
    await expect(action()).rejects.toThrow("Pending queue unavailable");
  } finally {
    db.pendingOperations.hook("creating").unsubscribe(reject);
  }
}

test("card creation rolls back both stores and memory, then retries once", async () => {
  const cardsBefore = MemoryDB.getCards().length;
  const operationsBefore = await db.operations.count();
  const pendingBefore = await db.pendingOperations.count();
  await rejectPendingWrite(() =>
    createNewCard("Atomic question", "Atomic answer", ["target-deck"]),
  );
  expect(MemoryDB.getCards().length).toBe(cardsBefore);
  expect(await db.operations.count()).toBe(operationsBefore);
  expect(await db.pendingOperations.count()).toBe(pendingBefore);
  const id = await createNewCard("Atomic question", "Atomic answer", [
    "target-deck",
  ]);
  expect(MemoryDB.getCards().length).toBe(cardsBefore + 1);
  expect(MemoryDB.getCardById(id)?.front).toBe("Atomic question");
  expect(
    MemoryDB.getCardsForDeck("target-deck").map((card) => card.id),
  ).toContain(id);
  expect((await db.operations.count()) - operationsBefore).toBe(
    (await db.pendingOperations.count()) - pendingBefore,
  );
});

test("deck creation does not publish a deck after storage rejection", async () => {
  const decksBefore = MemoryDB.getDecks().length;
  const operationsBefore = await db.operations.count();
  const pendingBefore = await db.pendingOperations.count();
  await rejectPendingWrite(() => createNewDeck("Atomic deck", ""));
  expect(MemoryDB.getDecks().length).toBe(decksBefore);
  expect(await db.operations.count()).toBe(operationsBefore);
  expect(await db.pendingOperations.count()).toBe(pendingBefore);
  await createNewDeck("Atomic deck", "");
  expect(MemoryDB.getDecks().length).toBe(decksBefore + 1);
});

test("card edit keeps the saved content until both writes commit", async () => {
  const id = await createNewCard("Original", "Answer");
  const operationsBefore = await db.operations.count();
  const pendingBefore = await db.pendingOperations.count();
  await rejectPendingWrite(() =>
    updateCardContentOperation(id, "Changed", "New answer"),
  );
  expect(MemoryDB.getCardById(id)?.front).toBe("Original");
  expect(MemoryDB.getCardById(id)?.back).toBe("Answer");
  expect(await db.operations.count()).toBe(operationsBefore);
  expect(await db.pendingOperations.count()).toBe(pendingBefore);
  await updateCardContentOperation(id, "Changed", "New answer");
  expect(MemoryDB.getCardById(id)?.front).toBe("Changed");
  expect(await db.operations.count()).toBe(operationsBefore + 1);
  expect(await db.pendingOperations.count()).toBe(pendingBefore + 1);
});
