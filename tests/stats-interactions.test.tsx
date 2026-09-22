import { test, expect } from "bun:test";
import { act } from "react";
import { Heatmap } from "@/components/stats/heatmap";
import { DurationTooltipLabel } from "@/components/stats/time-bar-chart";
import { render, click } from "./dom";

test("heatmap opens on tap and focus, switches selection, and dismisses on Escape", async () => {
  const view = await render(<Heatmap reviewLogs={[]} />);
  try {
    const [first, second] = [
      ...view.container.querySelectorAll<HTMLButtonElement>(
        "button[aria-label]",
      ),
    ];
    await click(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "0 reviews on",
    );
    await act(async () => {
      second.focus();
    });
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      second.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(second.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => {
      second.blur();
      first.focus();
    });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await act(async () => {
      first.blur();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  } finally {
    await view.unmount();
  }
});

test("duration tooltip totals all four states for day, week and month", async () => {
  for (const bucket of ["day", "week", "month"] as const) {
    const view = await render(
      <DurationTooltipLabel
        date="2026-09-22"
        bucket={bucket}
        data={{
          new: 60000,
          learning: 120000,
          relearning: 180000,
          review: 240000,
        }}
      />,
    );
    try {
      expect(view.container.textContent).toContain("Total: 10.0 min");
    } finally {
      await view.unmount();
    }
  }
});
