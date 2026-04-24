import { useEffect, useState } from "react";

export type ChromeInteractionMode = "hover" | "touch";

interface InputBehaviorSnapshot {
  chromeInteractionMode: ChromeInteractionMode;
  canHover: boolean;
  hasCoarsePointer: boolean;
}

interface MediaQuerySnapshot {
  canHover: boolean;
  hasFinePointer: boolean;
  primaryNoHover: boolean;
  hasCoarsePointer: boolean;
}

export const INPUT_BEHAVIOR_MEDIA_QUERIES = {
  anyHover: "(any-hover: hover)",
  anyFinePointer: "(any-pointer: fine)",
  hoverNone: "(hover: none)",
  pointerCoarse: "(pointer: coarse)",
} as const;

export function resolveInputBehaviorSnapshot(
  snapshot: MediaQuerySnapshot,
): InputBehaviorSnapshot {
  const { canHover, hasFinePointer, primaryNoHover, hasCoarsePointer } =
    snapshot;

  const chromeInteractionMode: ChromeInteractionMode =
    canHover && hasFinePointer
      ? "hover"
      : primaryNoHover && hasCoarsePointer
        ? "touch"
        : "hover";

  return {
    chromeInteractionMode,
    canHover,
    hasCoarsePointer,
  };
}

function getDefaultSnapshot(): InputBehaviorSnapshot {
  return {
    chromeInteractionMode: "hover",
    canHover: true,
    hasCoarsePointer: false,
  };
}

function readInputBehaviorSnapshot(): InputBehaviorSnapshot {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return getDefaultSnapshot();
  }

  return resolveInputBehaviorSnapshot({
    canHover: window.matchMedia(INPUT_BEHAVIOR_MEDIA_QUERIES.anyHover).matches,
    hasFinePointer: window.matchMedia(
      INPUT_BEHAVIOR_MEDIA_QUERIES.anyFinePointer,
    ).matches,
    primaryNoHover: window.matchMedia(INPUT_BEHAVIOR_MEDIA_QUERIES.hoverNone)
      .matches,
    hasCoarsePointer: window.matchMedia(
      INPUT_BEHAVIOR_MEDIA_QUERIES.pointerCoarse,
    ).matches,
  });
}

function addMediaQueryListener(
  mediaQueryList: MediaQueryList,
  listener: () => void,
) {
  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", listener);
    return () => mediaQueryList.removeEventListener("change", listener);
  }

  const legacyListener = listener as (event: MediaQueryListEvent) => void;
  mediaQueryList.addListener(legacyListener);
  return () => mediaQueryList.removeListener(legacyListener);
}

export function useInputBehavior(): InputBehaviorSnapshot {
  const [snapshot, setSnapshot] = useState<InputBehaviorSnapshot>(
    readInputBehaviorSnapshot,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQueryLists = Object.values(INPUT_BEHAVIOR_MEDIA_QUERIES).map(
      (query) => window.matchMedia(query),
    );
    const handleChange = () => {
      setSnapshot(readInputBehaviorSnapshot());
    };

    const removeListeners = mediaQueryLists.map((mediaQueryList) =>
      addMediaQueryListener(mediaQueryList, handleChange),
    );

    handleChange();

    return () => {
      removeListeners.forEach((removeListener) => removeListener());
    };
  }, []);

  return snapshot;
}
