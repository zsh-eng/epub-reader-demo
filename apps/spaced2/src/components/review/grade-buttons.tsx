import BouncyButton from "@/components/bouncy-button";
import { usePressableAction } from "@/components/hooks/use-pressable-action";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RATING_TO_KEY, RATING_TO_NAME } from "@/lib/card-mapping";
import { cn } from "@/lib/utils";
import { intlFormatDistance } from "date-fns";
import { useMemo } from "react";
import { previewGradeSchedule } from "@/lib/review/review";
import { Card, Grade, Rating } from "ts-fsrs";

type GradeButtonsProps = {
  onGrade: (grade: Grade) => void;
  card: Card;
};

function GradeButton({
  grade,
  onGrade,
  dateString,
}: {
  grade: Grade;
  onGrade: (grade: Grade) => void;
  dateString: string;
}) {
  const key = RATING_TO_KEY[grade] ?? "";
  const { pressed, elementRef, pressableProps } = usePressableAction({
    key,
    onAction: () => onGrade(grade),
  });

  return (
    <TooltipProvider key={grade} delayDuration={300}>
      <Tooltip>
        <TooltipTrigger
          ref={elementRef as React.RefObject<HTMLButtonElement>}
          {...pressableProps}
          className="flex-1"
        >
          <BouncyButton
            className={cn(
              "flex w-full flex-col justify-center gap-0 transition h-14 text-muted-foreground font-semibold border rounded-none group bg-primary relative",
            )}
            pressed={pressed}
          >
            <div className="absolute bottom-1 left-1 font-semibold text-base sm:text-sm uppercase text-background tracking-widest">
              {RATING_TO_NAME[grade]}
            </div>
            <div className="absolute top-0 right-2 text-sm text-background">
              {grade}
            </div>
          </BouncyButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center" sideOffset={8}>
          <Kbd className="text-md mr-2 text-background">{key}</Kbd>
          <p>Estimated: {dateString}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The buttons to rate a flashcard.
 */
export default function DesktopGradeButtons({
  onGrade,
  card,
}: GradeButtonsProps) {
  const { schedulingCards, now } = useMemo(() => {
    const now = new Date();
    return { schedulingCards: previewGradeSchedule(card, now), now };
  }, [card]);

  return (
    <div
      className={cn(
        "flex h-full gap-x-1 w-[36vw] grid-cols-4 bg-background dark:bg-muted dark:border-muted-foreground/30 dark:border p-1 rounded-none mt-12 shadow-md",
      )}
      style={{
        transform: `perspective(1000px) rotateX(24deg)`,
      }}
    >
      <GradeButton
        key={Rating.Again}
        grade={Rating.Again}
        onGrade={() => onGrade(Rating.Again)}
        dateString={intlFormatDistance(
          schedulingCards[Rating.Again].card.due,
          now,
        )}
      />

      <GradeButton
        key={Rating.Hard}
        grade={Rating.Hard}
        onGrade={() => onGrade(Rating.Hard)}
        dateString={intlFormatDistance(
          schedulingCards[Rating.Hard].card.due,
          now,
        )}
      />

      <GradeButton
        key={Rating.Good}
        grade={Rating.Good}
        onGrade={() => onGrade(Rating.Good)}
        dateString={intlFormatDistance(
          schedulingCards[Rating.Good].card.due,
          now,
        )}
      />

      <GradeButton
        key={Rating.Easy}
        grade={Rating.Easy}
        onGrade={() => onGrade(Rating.Easy)}
        dateString={intlFormatDistance(
          schedulingCards[Rating.Easy].card.due,
          now,
        )}
      />
    </div>
  );
}

DesktopGradeButtons.displayName = "GradeButtons";
