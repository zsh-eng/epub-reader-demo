import {
  INPUT_BEHAVIOR_MEDIA_QUERIES,
  useInputBehavior,
} from "@/hooks/use-input-behavior";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

type Snapshot = {
  chromeInteractionMode: "hover" | "touch";
  canHover: boolean;
  hasCoarsePointer: boolean;
};

class MockMediaQueryList implements MediaQueryList {
  media: string;
  matches: boolean;
  onchange:
    | ((this: MediaQueryList, event: MediaQueryListEvent) => void)
    | null = null;

  private changeListeners = new Set<(event: MediaQueryListEvent) => void>();

  constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    if (typeof listener === "function") {
      this.changeListeners.add(
        listener as (event: MediaQueryListEvent) => void,
      );
    }
  }

  removeEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    if (typeof listener === "function") {
      this.changeListeners.delete(
        listener as (event: MediaQueryListEvent) => void,
      );
    }
  }

  addListener(listener: (event: MediaQueryListEvent) => void) {
    this.changeListeners.add(listener);
  }

  removeListener(listener: (event: MediaQueryListEvent) => void) {
    this.changeListeners.delete(listener);
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  setMatches(matches: boolean) {
    this.matches = matches;
    const event = { matches, media: this.media } as MediaQueryListEvent;
    this.changeListeners.forEach((listener) => listener(event));
    this.onchange?.call(this, event);
  }
}

class MatchMediaController {
  private mediaQueryLists = new Map<string, MockMediaQueryList>();

  constructor(initialMatches: Record<string, boolean>) {
    for (const query of Object.values(INPUT_BEHAVIOR_MEDIA_QUERIES)) {
      this.mediaQueryLists.set(
        query,
        new MockMediaQueryList(query, initialMatches[query] ?? false),
      );
    }
  }

  matchMedia = (query: string): MediaQueryList => {
    const mediaQueryList = this.mediaQueryLists.get(query);
    if (!mediaQueryList) {
      throw new Error(`Unexpected media query: ${query}`);
    }

    return mediaQueryList;
  };

  setMatch(query: string, matches: boolean) {
    const mediaQueryList = this.mediaQueryLists.get(query);
    if (!mediaQueryList) {
      throw new Error(`Unexpected media query: ${query}`);
    }

    mediaQueryList.setMatches(matches);
  }
}

function createHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  return {
    container,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function readSnapshot(container: HTMLElement): Snapshot {
  const element = container.querySelector("[data-testid='snapshot']");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected snapshot probe to be rendered");
  }

  return JSON.parse(element.textContent ?? "") as Snapshot;
}

function renderProbe(root: Root) {
  function Probe() {
    const snapshot = useInputBehavior();
    return createElement(
      "pre",
      { "data-testid": "snapshot" },
      JSON.stringify(snapshot),
    );
  }

  act(() => {
    root.render(createElement(Probe));
  });
}

describe("useInputBehavior", () => {
  it("resolves hover-capable desktop environments to hover mode", () => {
    const controller = new MatchMediaController({
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyHover]: true,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyFinePointer]: true,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.hoverNone]: false,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.pointerCoarse]: false,
    });
    window.matchMedia = vi.fn(controller.matchMedia);

    const harness = createHarness();
    renderProbe(harness.root);

    expect(readSnapshot(harness.container)).toEqual({
      chromeInteractionMode: "hover",
      canHover: true,
      hasCoarsePointer: false,
    });

    harness.cleanup();
  });

  it("resolves touch-first environments to touch mode", () => {
    const controller = new MatchMediaController({
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyHover]: false,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyFinePointer]: false,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.hoverNone]: true,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.pointerCoarse]: true,
    });
    window.matchMedia = vi.fn(controller.matchMedia);

    const harness = createHarness();
    renderProbe(harness.root);

    expect(readSnapshot(harness.container)).toEqual({
      chromeInteractionMode: "touch",
      canHover: false,
      hasCoarsePointer: true,
    });

    harness.cleanup();
  });

  it("prefers hover mode for hybrid environments", () => {
    const controller = new MatchMediaController({
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyHover]: true,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyFinePointer]: true,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.hoverNone]: false,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.pointerCoarse]: true,
    });
    window.matchMedia = vi.fn(controller.matchMedia);

    const harness = createHarness();
    renderProbe(harness.root);

    expect(readSnapshot(harness.container)).toEqual({
      chromeInteractionMode: "hover",
      canHover: true,
      hasCoarsePointer: true,
    });

    harness.cleanup();
  });

  it("updates live when media-query matches change", () => {
    const controller = new MatchMediaController({
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyHover]: false,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.anyFinePointer]: false,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.hoverNone]: true,
      [INPUT_BEHAVIOR_MEDIA_QUERIES.pointerCoarse]: true,
    });
    window.matchMedia = vi.fn(controller.matchMedia);

    const harness = createHarness();
    renderProbe(harness.root);

    expect(readSnapshot(harness.container).chromeInteractionMode).toBe("touch");

    act(() => {
      controller.setMatch(INPUT_BEHAVIOR_MEDIA_QUERIES.anyHover, true);
      controller.setMatch(INPUT_BEHAVIOR_MEDIA_QUERIES.anyFinePointer, true);
      controller.setMatch(INPUT_BEHAVIOR_MEDIA_QUERIES.hoverNone, false);
      controller.setMatch(INPUT_BEHAVIOR_MEDIA_QUERIES.pointerCoarse, false);
    });

    expect(readSnapshot(harness.container)).toEqual({
      chromeInteractionMode: "hover",
      canHover: true,
      hasCoarsePointer: false,
    });

    harness.cleanup();
  });
});
