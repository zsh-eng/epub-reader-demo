import { useSessions } from "@/features/devices/use-sessions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    user: { id: "A" } as { id: string } | undefined,
    isLoading: false,
    isAuthenticated: true,
  },
  get: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/api", () => ({
  honoClient: { api: { sessions: { $get: state.get } } },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("isolates cached device lists across accounts and waits for ready authentication", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.auth = { user: { id: "A" }, isLoading: false, isAuthenticated: true };
  state.get.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ sessions: [{ id: "A-device" }] }),
  });
  const { result, rerender } = renderHook(useSessions, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe("A-device"));
  state.auth = { user: undefined, isLoading: false, isAuthenticated: false };
  rerender();
  expect(result.current.data).toBeUndefined();
  expect(state.get).toHaveBeenCalledTimes(1);
  state.auth = { user: { id: "B" }, isLoading: true, isAuthenticated: true };
  rerender();
  expect(result.current.data).toBeUndefined();
  expect(state.get).toHaveBeenCalledTimes(1);
  let finish!: (value: unknown) => void;
  state.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  state.auth = { user: { id: "B" }, isLoading: false, isAuthenticated: true };
  rerender();
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  finish({ ok: true, json: async () => ({ sessions: [{ id: "B-device" }] }) });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe("B-device"));
  client.clear();
});
