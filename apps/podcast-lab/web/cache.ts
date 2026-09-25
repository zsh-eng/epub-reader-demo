import { QueryClient } from "@tanstack/query-core";

/** Reuse metadata while navigating; audio bytes stay in the media/range cache. */
export const queries = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 300_000, gcTime: 1_800_000, retry: 1 },
  },
});
export function getJSON<T>(path: string): Promise<T> {
  return queries.fetchQuery({
    queryKey: [path],
    queryFn: async ({ signal }) => {
      const response = await fetch(path, { signal });
      if (!response.ok)
        throw new Error("This local item is unavailable. Try again.");
      return response.json() as Promise<T>;
    },
  });
}
