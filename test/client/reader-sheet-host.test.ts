import { ReaderSheetHost } from "@/components/Reader/ReaderSheetHost";
import type { ReaderSettings } from "@/types/reader.types";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/Reader/ReaderToolsSidebar", () => ({
  ReaderToolsSidebar: () => "desktop reader sidebar",
}));

vi.mock("@/components/Reader/ReaderToolsLauncherSheet", () => ({
  ReaderToolsLauncherSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "mobile reader launcher" : null,
}));

vi.mock("@/components/Reader/ReaderContentsSheet", () => ({
  ReaderContentsSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "mobile contents sheet" : null,
}));

vi.mock("@/components/Reader/ReaderSettingsSheet", () => ({
  ReaderSettingsSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "mobile settings sheet" : null,
}));

const settings: ReaderSettings = {
  fontSize: 16,
  lineHeight: 1.5,
  fontFamily: "lora",
  theme: "light",
  textAlign: "left",
  contentWidth: "narrow",
  publisherBookStylingEnabled: false,
  matchPublisherBodyTextSize: false,
};

function renderHost(isMobile: boolean) {
  render(
    createElement(ReaderSheetHost, {
      isMobile,
      activeSheet: "tools",
      onOpenSheet: vi.fn(),
      onCloseSheet: vi.fn(),
      settings,
      onUpdateSettings: vi.fn(),
      toc: [],
      chapterEntries: [],
      chapterStartPages: [],
      currentChapterHref: "",
      onNavigateToHref: vi.fn(() => true),
    }),
  );
}

afterEach(cleanup);

describe("ReaderSheetHost", () => {
  it("keeps the existing sheet launcher on mobile", () => {
    renderHost(true);

    expect(screen.getByText("mobile reader launcher")).toBeTruthy();
    expect(screen.queryByText("desktop reader sidebar")).toBeNull();
  });

  it("uses the reader tools sidebar on desktop", () => {
    renderHost(false);

    expect(screen.getByText("desktop reader sidebar")).toBeTruthy();
    expect(screen.queryByText("mobile reader launcher")).toBeNull();
  });
});
