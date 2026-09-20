import type { CardWithMetadata } from "@/lib/types";

// The visible card is a snapshot. Database notifications must not replace it.
let active = false;
let current: CardWithMetadata | undefined;
const listeners = new Set<() => void>();
export const reviewSession = {
  start() {
    active = true;
  },
  stop() {
    active = false;
    reviewSession.select();
  },
  restore(card?: CardWithMetadata) {
    if (active) reviewSession.select(card);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => current,
  select(card?: CardWithMetadata) {
    current = card ? structuredClone(card) : undefined;
    for (const listener of listeners) listener();
  },
  advance(cardId: string) {
    if (current?.id === cardId) reviewSession.select();
  },
  refresh(card: CardWithMetadata) {
    if (current?.id === card.id) reviewSession.select(card);
  },
};
