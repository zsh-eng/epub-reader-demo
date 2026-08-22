import { AppMobileNavigationSheets } from "@/components/AppMobileNavigationSheets";
import type { RecentlyReadBook } from "@/lib/library-sort";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const recentReading: RecentlyReadBook = {
  book: {
    id: "book-1",
    fileHash: "epub-hash",
    title: "Book One",
    author: "Author One",
    fileSize: 100,
    dateAdded: 1,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    isDownloaded: 1,
    coverContentHash: "cover-hash",
    _hlc: "1-0-device",
    _deviceId: "device",
    _isDeleted: 0,
    _serverTimestamp: 1,
  },
  lastRead: Date.now(),
};

function renderSheets() {
  const onClose = vi.fn();
  const onSignOut = vi.fn(async () => undefined);

  render(
    createElement(
      MemoryRouter,
      null,
      createElement(AppMobileNavigationSheets, {
        isOpen: true,
        onClose,
        activePath: "/",
        recentReading,
        recentBookCoverUrl: "blob:cover",
        isDarkTheme: false,
        onThemeToggle: vi.fn(),
        isOnline: true,
        isSyncing: false,
        onSync: vi.fn(async () => undefined),
        isAuthenticated: true,
        isAuthLoading: false,
        user: {
          name: "Jane Reader",
          email: "jane@example.com",
          image: null,
        },
        onSignIn: vi.fn(async () => undefined),
        onSignOut,
      }),
    ),
  );

  return { onClose, onSignOut };
}

afterEach(cleanup);

describe("AppMobileNavigationSheets", () => {
  it("uses a circular cover for the continuation target", () => {
    renderSheets();

    const continueLink = screen.getByRole("link", {
      name: "Continue reading Book One",
    });
    const cover = continueLink.querySelector("img");

    expect(cover?.parentElement?.classList.contains("rounded-full")).toBe(true);
  });

  it("opens account actions as a peer sheet and returns to navigation", async () => {
    renderSheets();

    fireEvent.click(
      screen.getByRole("button", {
        name: /05 Jane Reader jane@example.com/,
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Account" })).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: /01 Devices/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /02 Sync now/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /03 Sign out/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to navigation" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Reader" })).toBeTruthy(),
    );
  });
});
