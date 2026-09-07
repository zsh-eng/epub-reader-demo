import { CardWithMetadata } from "@/lib/types";
import { toast } from "sonner";
import { useState } from "react";

/** Keep an open action tied to the card that the user selected. */
export function useReviewActionTarget(
  cards: CardWithMetadata[],
  current?: CardWithMetadata,
) {
  const [target, setTarget] = useState<CardWithMetadata>();
  const capture = () => setTarget(current);
  const getTarget = (required = false) => {
    const live = cards.find((card) => card.id === target?.id && !card.deleted);
    if (!live) {
      const message =
        "This card is no longer available. Close this action and try again.";
      if (required) throw new Error(message);
      toast.error(message);
    }
    return live;
  };
  return { target, capture, getTarget };
}
