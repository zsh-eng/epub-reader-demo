import EditFlashcardResponsive from "@/components/card-actions/edit-flashcard-responsive";
import { useCurrentCard } from "@/components/hooks/query";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CardContentFormValues } from "@/lib/form-schema";
import { handleCardEdit } from "@/lib/review/actions";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

export default function EditFlashcardAction() {
  const currentCard = useCurrentCard();
  const [open, setOpen] = useState(false);

  const handleEdit = async (values: CardContentFormValues) => {
    if (!currentCard) return;
    await handleCardEdit(values, currentCard);
    setOpen(false);
  };

  if (!currentCard) return null;

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
