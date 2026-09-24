import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Card, State } from "ts-fsrs";

const STATE_TO_NAME = {
  [State.New]: "New",
  [State.Learning]: "Learning",
  [State.Review]: "Review",
  [State.Relearning]: "Relearning",
};

export default function CurrentCardBadge({ card }: { card: Card }) {
  return (
    <Badge
      variant="dot"
      className={cn("hidden sm:inline-flex", {
        "before:bg-blue-500": card?.state === State.New,
        "before:bg-red-500":
          card?.state === State.Relearning || card?.state === State.Learning,
        "before:bg-green-500": card?.state === State.Review,
      })}
    >
      {STATE_TO_NAME[card?.state]}
    </Badge>
  );
}
