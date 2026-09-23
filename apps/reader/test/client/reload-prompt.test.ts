import { ReloadPrompt } from "@/components/ReloadPrompt";
import { act, cleanup, render } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const registrationCallback = vi.hoisted(() => ({
  current: (_registration: ServiceWorkerRegistration | undefined) => {},
}));
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: {
    onRegistered: typeof registrationCallback.current;
  }) => {
    registrationCallback.current = options.onRegistered;
    return {
      offlineReady: [false, vi.fn()],
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(),
    };
  },
}));
const hour = 60 * 60 * 1000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("polls only the current registration and stops after unmount", async () => {
  const first = { update: vi.fn().mockResolvedValue(undefined) };
  const second = { update: vi.fn().mockResolvedValue(undefined) };
  const view = render(
    createElement(StrictMode, null, createElement(ReloadPrompt)),
  );
  act(() =>
    registrationCallback.current(first as unknown as ServiceWorkerRegistration),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(hour);
  });
  expect(first.update).toHaveBeenCalledOnce();
  act(() =>
    registrationCallback.current(
      second as unknown as ServiceWorkerRegistration,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(hour);
  });
  expect(first.update).toHaveBeenCalledOnce();
  expect(second.update).toHaveBeenCalledOnce();
  view.unmount();
  await vi.advanceTimersByTimeAsync(hour);
  expect(second.update).toHaveBeenCalledOnce();
});

it("does not start polling when registration finishes after unmount", async () => {
  const registration = { update: vi.fn().mockResolvedValue(undefined) };
  const view = render(createElement(ReloadPrompt));
  const onRegistered = registrationCallback.current;
  view.unmount();
  act(() => onRegistered(registration as unknown as ServiceWorkerRegistration));
  await vi.advanceTimersByTimeAsync(hour);
  expect(registration.update).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
