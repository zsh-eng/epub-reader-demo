import { useUndoStack } from "@/components/hooks/query";
import { undoGradeCard } from "@/lib/sync/operation";
import { isEventTargetInput } from "@/lib/utils";
import { Redo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export default function UndoGradeButton() {
  const undoStack = useUndoStack();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const undo = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await undoGradeCard();
      if (result.applied)
        toast("Undo successful", { icon: <Redo2 className="size-4" /> });
    } catch {
      toast.error("Could not undo the grade.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  useEffect(() => {
    if (undoStack.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEventTargetInput(event) || event.repeat) return;
      if (event.ctrlKey && event.key === "z") {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoStack.length, undo]);

  if (undoStack.length === 0) return null;
  return (
    <button
      type="button"
      aria-label="Undo last grade"
      disabled={pending}
      className="px-2 py-3 cursor-pointer"
      onClick={() => void undo()}
    >
      <Redo2 className="size-6 text-muted-foreground/50 hover:text-muted-foreground transition-all rotate-180" />
    </button>
  );
}
