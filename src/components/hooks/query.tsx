import { useClock } from "./use-clock";
import MemoryDB from "@/lib/db/memory";
import { useSyncExternalStore } from "react";

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export function useCards() {
  const snapshot = useSyncExternalStore(
    MemoryDB.subscribe,
    MemoryDB.getSnapshot,
  );
  return snapshot.getCards();
}

export function useReviewCards() {
  const cards = useCards();
  const now = useClock(
    cards.flatMap((card) => [
      card.due.getTime(),
      card.suspended?.getTime() ?? 0,
    ]),
  );
  // Let's sort the cards deterministically by id, such that the order we get is "randomised"
  const reviewCards = cards
    .filter((card) => card.due.getTime() <= now)
    .filter((card) => !card.suspended || card.suspended.getTime() <= now)
    .sort((a, b) => hashId(a.id) - hashId(b.id));

  return reviewCards;
}

export function useDecks() {
  const snapshot = useSyncExternalStore(
    MemoryDB.subscribe,
    MemoryDB.getSnapshot,
  );
  return snapshot.getDecks();
}

export function useDeck(id: string) {
  const snapshot = useSyncExternalStore(
    MemoryDB.subscribe,
    MemoryDB.getSnapshot,
  );
  return snapshot.getDeckById(id);
}

export function useCardsForDeck(deckId: string) {
  const snapshot = useSyncExternalStore(
    MemoryDB.subscribe,
    MemoryDB.getSnapshot,
  );
  return snapshot.getCardsForDeck(deckId);
}

export function useCurrentCard() {
  const cards = useReviewCards();
  return cards[0];
}

export function useUndoStack() {
  const snapshot = useSyncExternalStore(
    MemoryDB.subscribe,
    MemoryDB.getSnapshot,
  );
  return snapshot.getUndoStack();
}
