import { FooterPageIndicator } from "@/features/reader/footer/FooterPageIndicator";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
afterEach(cleanup);
it("keeps numbers absent through loading and reveals only a ready page", () => {
  const { rerender } = render(
    createElement(FooterPageIndicator, {
      currentPage: 3,
      totalPages: 10,
      isLoading: true,
    }),
  );
  expect(screen.queryByTestId("reader-page-indicator")).toBeNull();
  rerender(
    createElement(FooterPageIndicator, { currentPage: 3, totalPages: 10 }),
  );
  expect(screen.getByTestId("reader-page-indicator").textContent).toContain(
    "of 10",
  );
  rerender(
    createElement(FooterPageIndicator, {
      currentPage: 3,
      totalPages: 10,
      showPageNumbers: false,
    }),
  );
  expect(screen.queryByTestId("reader-page-indicator")).toBeNull();
});
