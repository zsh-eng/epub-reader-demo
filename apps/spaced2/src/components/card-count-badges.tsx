import { useReviewCards } from "@/components/hooks/query";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { State } from "ts-fsrs";

export default function CardCountBadges() {
  const reviewCards = useReviewCards();
  const numNewCards = reviewCards?.filter(
    (card) => card.state === State.New,
  ).length;
  const numLearningCards = reviewCards?.filter(
    (card) => card.state === State.Learning || card.state === State.Relearning,
  ).length;
  const numReviewCards = reviewCards?.filter(
    (card) => card.state === State.Review,
  ).length;

  return (
    <div className="hidden sm:flex h-8 justify-center gap-2">
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger className="cursor-text">
            <Badge variant="dot" className="h-full before:bg-blue-500">
              {numNewCards}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>New</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger className="cursor-text">
            <Badge variant="dot" className="h-full before:bg-red-500">
              {numLearningCards}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Learning</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger className="cursor-text">
            <Badge variant="dot" className="h-full before:bg-green-500">
              {numReviewCards}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Review</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
