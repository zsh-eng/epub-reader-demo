import { ReaderSheetHost } from "@/features/reader/ReaderSheetHost";
import type { Book } from "@/lib/db";
import type { ReaderSettings } from "@/types/reader.types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/reader/ReaderToolsSidebar", () => ({
  ReaderToolsSidebar: () => "desktop reader sidebar",
}));

vi.mock("@/features/reader/ReaderToolsLauncherSheet", () => ({
  ReaderToolsLauncherSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "mobile reader launcher" : null,
}));

vi.mock("@/features/reader/ReaderContentsSheet", () => ({
  ReaderContentsSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "mobile contents sheet" : null,
}));

vi.mock("@/features/reader/ReaderSettingsSheet", () => ({
  ReaderSettingsSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? "mobile settings sheet" : null,
}));

vi.mock("@/features/reader/ReaderBookActionsSheet", () => ({
  ReaderBookActionsSheet: ({
    isOpen,
    onBack,
  }: {
    isOpen: boolean;
    onBack: () => void;
  }) =>
    isOpen
      ? createElement("button", { onClick: onBack }, "Book actions")
      : null,
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

const book = { id: "book-1" } as Book;

function renderHost(
  isMobile: boolean,
  activeSheet: "tools" | "book-actions" = "tools",
) {
  const onOpenSheet = vi.fn();
  render(
    createElement(ReaderSheetHost, {
      isMobile,
      activeSheet,
      onOpenSheet,
      onCloseSheet: vi.fn(),
      book,
      settings,
      onUpdateSettings: vi.fn(),
      toc: [],
      chapterEntries: [],
      chapterStartPages: [],
      currentChapterHref: "",
      onNavigateToHref: vi.fn(() => true),
    }),
  );

  return { onOpenSheet };
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

  it("keeps the full book actions sheet in the mobile reader tools", () => {
    const { onOpenSheet } = renderHost(true, "book-actions");

    fireEvent.click(screen.getByRole("button", { name: "Book actions" }));

    expect(onOpenSheet).toHaveBeenCalledWith("tools");
    expect(screen.queryByText("mobile reader launcher")).toBeNull();
  });
});
