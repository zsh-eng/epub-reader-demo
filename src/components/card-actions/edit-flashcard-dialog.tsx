import EditFlashcardFooterActions from "@/components/card-actions/edit-flashcard-footer-actions";
import { type EditFlashcardActions } from "@/components/card-actions/edit-flashcard-responsive";
import { CreateUpdateFlashcardForm } from "@/components/create-flashcard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type MutableRefObject } from "react";
import { type UseFormReturn } from "react-hook-form";
import { CardContentFormValues } from "@/lib/form-schema";
import { CardWithMetadata } from "@/lib/types";

type EditFlashcardDialogProps = {
  onEdit: (values: CardContentFormValues) => void | Promise<void>;
  form: UseFormReturn<CardContentFormValues>;
  submitLock: MutableRefObject<boolean>;
  beforeAction: (action: string) => boolean;
  card: CardWithMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: EditFlashcardActions;
};

export default function EditFlashcardDialog({
  card,
  open,
  onOpenChange,
  onEdit,
  actions,
  form,
  submitLock,
  beforeAction,
}: EditFlashcardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-2 pt-6 gap-0">
        <DialogHeader className="text-center">
          <DialogTitle className="text-center text-lg">
            Edit Flashcard
          </DialogTitle>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
