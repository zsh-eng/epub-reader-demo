import { reviewSession } from "./session";
import MemoryDB from "@/lib/db/memory";
import { CardContentFormValues } from "@/lib/form-schema";
import {
  updateBookmarkedClientSide,
  updateCardContentOperation,
  updateDeletedClientSide,
  updateSuspendedClientSide,
} from "@/lib/sync/operation";
import { CardWithMetadata } from "@/lib/types";
import { MAX_DATE } from "@/lib/utils";
import VibrationPattern from "@/lib/vibrate";
import { BookmarkIcon, ChevronsRight, Eye, EyeOff, Trash } from "lucide-react";
import { toast } from "sonner";

export async function handleCardDelete(reviewCard?: CardWithMetadata) {
  if (!reviewCard) return;
  const previousDeleted = reviewCard.deleted;
  await updateDeletedClientSide(reviewCard.id, true);
  reviewSession.advance(reviewCard.id);
  toast("Card deleted", {
    icon: <Trash className="size-4" />,
    action: {
      label: "Undo",
      onClick: () => {
        void updateDeletedClientSide(reviewCard.id, previousDeleted);
      },
    },
  });
}

export async function handleCardSuspend(reviewCard?: CardWithMetadata) {
  if (!reviewCard) return;
  const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);
  await updateSuspendedClientSide(reviewCard.id, tenMinutesFromNow);
  reviewSession.advance(reviewCard.id);
  navigator?.vibrate?.(VibrationPattern.buttonTap);
  toast("Skipped for 10 minutes", {
    icon: <ChevronsRight className="size-4" />,
  });
}

export async function handleCardBury(reviewCard?: CardWithMetadata) {
  if (!reviewCard) return;
  const previousSuspended = reviewCard.suspended ?? new Date(0);
  await updateSuspendedClientSide(reviewCard.id, MAX_DATE);
  reviewSession.advance(reviewCard.id);
  navigator?.vibrate?.(VibrationPattern.buttonTap);
  toast("You won't see this card again", {
    icon: <EyeOff className="size-4" />,
    action: {
      label: "Undo",
      onClick: () => {
        void updateSuspendedClientSide(reviewCard.id, previousSuspended);
      },
    },
  });
}

export async function handleCardUnsuspend(reviewCard?: CardWithMetadata) {
  if (!reviewCard) return;
  await updateSuspendedClientSide(reviewCard.id, new Date(0));
  toast("Card unsuspended", {
    icon: <Eye className="size-4" />,
  });
}

export async function handleCardSave(
  bookmarked: boolean,
  reviewCard?: CardWithMetadata,
) {
  if (!reviewCard) return;
  await updateBookmarkedClientSide(reviewCard.id, bookmarked);
  const updated = MemoryDB.getCardById(reviewCard.id);
  if (updated) reviewSession.refresh(updated);
  if (bookmarked) {
    navigator?.vibrate?.(VibrationPattern.successConfirm);
    toast("Saved", {
      icon: (
        <BookmarkIcon className="size-4 text-primary" fill="currentColor" />
      ),
    });
  } else {
    toast("Removed from saved");
  }
}

export async function handleCardEdit(
  values: CardContentFormValues,
  reviewCard?: CardWithMetadata,
) {
  if (!reviewCard) return;
  const hasChanged =
    reviewCard.front !== values.front || reviewCard.back !== values.back;

  if (hasChanged) {
    await updateCardContentOperation(reviewCard.id, values.front, values.back);
    const updated = MemoryDB.getCardById(reviewCard.id);
    if (updated) reviewSession.refresh(updated);
  }
}
