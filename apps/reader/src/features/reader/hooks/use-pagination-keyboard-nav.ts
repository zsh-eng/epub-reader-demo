import { useHotkey } from "@tanstack/react-hotkeys";

interface UsePaginationKeyboardNavOptions {
  onNextSpread: () => void;
  onPrevSpread: () => void;
}

export function usePaginationKeyboardNav(
  options: UsePaginationKeyboardNavOptions,
) {
  const { onNextSpread, onPrevSpread } = options;

  useHotkey("ArrowLeft", onPrevSpread, {
    target: window,
    ignoreInputs: true,
    stopPropagation: false,
    meta: {
      name: "Previous page",
      description: "Move to the previous Reader spread",
    },
  });

  useHotkey("ArrowRight", onNextSpread, {
    target: window,
    ignoreInputs: true,
    stopPropagation: false,
    meta: {
      name: "Next page",
      description: "Move to the next Reader spread",
    },
  });
}
