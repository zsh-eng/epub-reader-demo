import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { act } from "react";
import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";
import { BasicStats } from "@/components/stats/basic";
import { ReviewChart } from "@/components/stats/review-chart";
import { Heatmap } from "@/components/stats/heatmap";
import { render } from "./dom";

const views: Awaited<ReturnType<typeof render>>[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  setSystemTime();
});
function log(date: Date) {
  return fsrs().repeat(createEmptyCard(), date)[Rating.Good].log;
}
function stat(container: HTMLElement, label: string) {
  return [...container.querySelectorAll("span")]
    .find((node) => node.textContent === label)
    ?.previousElementSibling?.textContent?.trim();
}
test("adjacent study days form a streak across midnight; 04:00 focus clears it", async () => {
  setSystemTime(new Date(2026, 0, 2, 3, 59));
  const logs = [
    log(new Date(2025, 11, 31, 23)),
    log(new Date(2026, 0, 1, 4)),
    log(new Date(2026, 0, 2, 0)),
  ];
  const view = await render(<BasicStats reviewLogs={logs} />);
  views.push(view);
  expect(stat(view.container, "Days Studied")).toBe("2");
  expect(stat(view.container, "Current Streak")).toBe("2");
  expect(stat(view.container, "Reviews/Day")).toBe("1.5");
  setSystemTime(new Date(2026, 0, 2, 4));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(stat(view.container, "Current Streak")).toBe("0");
  expect(stat(view.container, "Longest Streak")).toBe("2");
});
test("range cutoff includes the first full study day and heatmap uses its date", async () => {
  setSystemTime(new Date(2026, 8, 13, 23));
  const logs = [
    log(new Date(2026, 5, 13, 3, 59)),
    log(new Date(2026, 5, 13, 4)),
    log(new Date(2026, 5, 14, 3, 59)),
  ].map((log) => ({ ...log, state: State.New }));
  const view = await render(
    <>
      <ReviewChart reviewLogs={logs} />
      <Heatmap reviewLogs={logs} />
    </>,
  );
  views.push(view);
  expect(view.container.querySelector("button[data-active]")?.textContent).toBe(
    "New2",
  );
  expect(
    view.container.querySelector(
      'button[aria-label="2 reviews on 2026-06-13"]',
    ),
  ).not.toBeNull();
});

test("statistics schedule a refresh at local 04:00 without a focus event", async () => {
  setSystemTime(new Date(2026, 8, 13, 3, 59, 59));
  let refresh: (() => void) | undefined;
  let delay: number | undefined;
  const timer = spyOn(window, "setTimeout").mockImplementation(((
    callback: () => void,
    milliseconds: number,
  ) => {
    refresh = callback;
    delay = milliseconds;
    return 0;
  }) as typeof window.setTimeout);
  try {
    const view = await render(
      <BasicStats reviewLogs={[log(new Date(2026, 8, 12, 20))]} />,
    );
    views.push(view);
    expect(delay).toBe(1001);
    expect(stat(view.container, "Current Streak")).toBe("1");
    setSystemTime(new Date(2026, 8, 13, 4, 0, 0, 1));
    await act(async () => {
      refresh?.();
    });
    expect(stat(view.container, "Current Streak")).toBe("0");
    expect(delay).toBe(86_400_000);
  } finally {
    timer.mockRestore();
  }
});
