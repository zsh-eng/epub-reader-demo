import {
  ReaderSettingsList,
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "@/components/Reader/ReaderSettingsSheet";
import type { ReaderSettings } from "@/types/reader.types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
const originalScrollIntoView = Element.prototype.scrollIntoView;

function SettingsPanelHarness() {
  const [activeTab, setActiveTab] = useState<ReaderSettingsPanelTab>("type");

  return createElement(ReaderSettingsPanel, {
    settings,
    onUpdateSettings: vi.fn(),
    activeTab,
    onActiveTabChange: setActiveTab,
  });
}

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("ReaderSettingsPanel", () => {
  it("separates type controls from layout controls in a shorter panel", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(createElement(SettingsPanelHarness));

    expect(screen.getByRole("heading", { name: "Font Family" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Publisher Styling" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Font Size" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Line Height" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));

    expect(screen.getByRole("heading", { name: "Line Height" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Alignment" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Font Family" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Theme" }));
    expect(screen.getByRole("heading", { name: "Theme" })).toBeTruthy();
  });

  it("shows all appearance controls in one desktop scroll list", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      createElement(ReaderSettingsList, {
        settings,
        onUpdateSettings: vi.fn(),
      }),
    );

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("heading", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Font Family" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Font Size" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Line Height" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Alignment" })).toBeTruthy();
  });
});
