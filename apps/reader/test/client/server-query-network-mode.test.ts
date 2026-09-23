import { useSessions } from "@/features/devices/use-sessions";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "test-user" },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

const client = new QueryClient({
  // Match the app default to verify the server query override.
  defaultOptions: { queries: { networkMode: "always", retry: false } },
});

afterEach(() => {
  cleanup();
  client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

it("waits for reconnect before fetching server sessions despite the local query default", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sessions: [] }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  onlineManager.setOnline(false);
  const { result } = renderHook(() => useSessions(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });

  expect(result.current.fetchStatus).toBe("paused");
  expect(fetch).not.toHaveBeenCalled();
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual([]);
  expect(fetch).toHaveBeenCalledOnce();
});
