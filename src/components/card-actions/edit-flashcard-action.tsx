import EditFlashcardResponsive from "@/components/card-actions/edit-flashcard-responsive";
import { useCurrentCard } from "@/components/hooks/query";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CardContentFormValues } from "@/lib/form-schema";
import { updateCardContentOperation } from "@/lib/sync/operation";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

export default function EditFlashcardAction() {
  const currentCard = useCurrentCard();
  const [open, setOpen] = useState(false);

  const handleEdit = async (values: CardContentFormValues) => {
    const hasChanged =
      currentCard.front !== values.front || currentCard.back !== values.back;
    if (hasChanged) {
      await updateCardContentOperation(
        currentCard.id,
        values.front,
        values.back,
      );
    }
    setOpen(false);
  };

  return (
    <div>
      <EditFlashcardResponsive
        card={currentCard}
        open={open}
        onOpenChange={setOpen}
        onEdit={handleEdit}
      />

      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
              <PencilIcon className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
