import EditFlashcardFooterActions from "@/components/card-actions/edit-flashcard-footer-actions";
import { type EditFlashcardActions } from "@/components/card-actions/edit-flashcard-responsive";
import { CreateUpdateFlashcardForm } from "@/components/create-flashcard";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { type MutableRefObject } from "react";
import { type UseFormReturn } from "react-hook-form";
import { CardContentFormValues } from "@/lib/form-schema";
import { CardWithMetadata } from "@/lib/types";

type EditFlashcardDrawerProps = {
  onEdit: (values: CardContentFormValues) => void | Promise<void>;
  form: UseFormReturn<CardContentFormValues>;
  submitLock: MutableRefObject<boolean>;
  beforeAction: (action: string) => boolean;
  card: CardWithMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: EditFlashcardActions;
};

export default function EditFlashcardDrawer({
  card,
  open,
  onOpenChange,
  onEdit,
  actions,
  form,
  submitLock,
  beforeAction,
}: EditFlashcardDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="w-full">
        <DrawerHeader>
          <DrawerTitle>Edit Flashcard</DrawerTitle>
        </DrawerHeader>

        <CreateUpdateFlashcardForm
          form={form}
          submitLock={submitLock}
          onSubmit={onEdit}
          initialFront={card.front}
          initialBack={card.back}
        />

        {actions && (
          <EditFlashcardFooterActions
            disabled={form.formState.isSubmitting}
            beforeAction={beforeAction}
            actions={actions}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}
