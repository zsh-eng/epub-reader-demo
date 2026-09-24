import { usePressableAction } from "@/components/hooks/use-pressable-action";
import { RATING_TO_KEY } from "@/lib/card-mapping";
import VibrationPattern from "@/lib/vibrate";
import { Check, X } from "lucide-react";
import { useRef } from "react";
import { Grade, Rating } from "ts-fsrs";

type MobileGradeButtonsProps = {
  onGrade: (grade: Grade) => void;
};

export default function MobileGradeButtons({
  onGrade,
}: MobileGradeButtonsProps) {
  const hardButtonRef = useRef<HTMLButtonElement>(null);
  const againButtonRef = useRef<HTMLButtonElement>(null);
  const goodButtonRef = useRef<HTMLButtonElement>(null);
  const easyButtonRef = useRef<HTMLButtonElement>(null);

  const handleHard = () => {
    navigator?.vibrate?.(VibrationPattern.successConfirm);
    onGrade(Rating.Hard);
  };

  const handleAgain = () => {
    navigator?.vibrate?.(VibrationPattern.errorAlert);
    onGrade(Rating.Again);
  };

  const handleGood = () => {
    navigator?.vibrate?.(VibrationPattern.successConfirm);
    onGrade(Rating.Good);
  };

  const handleEasy = () => {
    navigator?.vibrate?.(VibrationPattern.successConfirm);
    onGrade(Rating.Easy);
  };

  const { pressed: hardPressed, pressableProps: hardProps } =
    usePressableAction({
      key: RATING_TO_KEY[Rating.Hard],
      onAction: handleHard,
    });

  const { pressed: againPressed, pressableProps: againProps } =
    usePressableAction({
      key: RATING_TO_KEY[Rating.Again],
      onAction: handleAgain,
    });

  const { pressed: goodPressed, pressableProps: goodProps } =
    usePressableAction({
      key: RATING_TO_KEY[Rating.Good],
      onAction: handleGood,
    });

  const { pressed: easyPressed, pressableProps: easyProps } =
    usePressableAction({
      key: RATING_TO_KEY[Rating.Easy],
      onAction: handleEasy,
    });

  return (
    <div className="w-full flex justify-center items-stretch gap-1 bg-muted-foreground/10 backdrop-blur-lg rounded-b-2xl p-2">
      <button
        type="button"
        aria-label="Hard"
        ref={hardButtonRef}
        className={`bg-muted rounded-bl-xl h-28 w-16 flex items-center justify-center active:scale-95 transition-all duration-100 ${
          hardPressed ? "scale-95" : ""
        }`}
        {...hardProps}
      >
        <X className="size-6 text-primary" />
      </button>

      <div className="flex flex-col gap-0.5 justify-end flex-1 h-28 bg-transparent">
        <button
          ref={againButtonRef}
          className={`bg-muted text-muted-foreground/30 uppercase text-sm font-bold tracking-widest py-2 flex-1 active:scale-95 transition-all duration-100 ${
            againPressed ? "scale-95" : ""
          }`}
          {...againProps}
        >
          Again
        </button>
        <button
          ref={goodButtonRef}
          className={`bg-muted text-primary text-center w-full rounded-none h-18 tracking-widest font-bold uppercase text-xl active:scale-95 transition-all duration-100 ${
            goodPressed ? "scale-95" : ""
          }`}
          {...goodProps}
        >
          Good
        </button>
      </div>

      <button
        type="button"
        aria-label="Easy"
        ref={easyButtonRef}
        className={`bg-muted rounded-br-xl h-28 w-16 flex items-center justify-center active:scale-95 transition-all duration-100 ${
          easyPressed ? "scale-95" : ""
        }`}
        {...easyProps}
      >
        <Check className="size-6 text-primary" />
      </button>
    </div>
  );
}
