import EditFlashcardDialog from "@/components/card-actions/edit-flashcard-dialog";
import EditFlashcardDrawer from "@/components/card-actions/edit-flashcard-drawer";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  cardContentFormSchema,
  CardContentFormValues,
} from "@/lib/form-schema";
import { CardWithMetadata } from "@/lib/types";
import { useMediaQuery } from "@uidotdev/usehooks";

export type EditFlashcardActions = {
  bookmarked: boolean;
  onBookmark: (bookmarked: boolean) => void;
  onDelete: () => void;
  onBury: () => void;
  suspended?: Date;
  onUnsuspend?: () => void;
};

type EditFlashcardResponsiveProps = {
  card: CardWithMetadata;
  onEdit: (values: CardContentFormValues) => void | Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: EditFlashcardActions;
};

export default function EditFlashcardResponsive(
  props: EditFlashcardResponsiveProps,
) {
  return props.open ? (
    <EditFlashcardSession key={props.card.id} {...props} />
  ) : null;
}

function EditFlashcardSession({
  card,
  onEdit,
  open,
  onOpenChange,
  actions,
}: EditFlashcardResponsiveProps) {
  const submitLock = useRef(false);
  const form = useForm<CardContentFormValues>({
    resolver: zodResolver(cardContentFormSchema),
    defaultValues: { front: card.front, back: card.back },
  });
  const isMobile = useMediaQuery("(max-width: 640px)");

  return isMobile ? (
    <EditFlashcardDrawer
      form={form}
      submitLock={submitLock}
      card={card}
      open={open}
      onOpenChange={(value) => {
        if (!submitLock.current) onOpenChange(value);
      }}
      onEdit={onEdit}
      actions={actions}
    />
  ) : (
    <EditFlashcardDialog
      form={form}
      submitLock={submitLock}
      card={card}
      open={open}
      onOpenChange={(value) => {
        if (!submitLock.current) onOpenChange(value);
      }}
      onEdit={onEdit}
      actions={actions}
    />
  );
}
