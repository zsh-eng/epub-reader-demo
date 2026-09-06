import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/600.css";
import "@/App.css";
import "./styles.css";

import { HighlightsMasonry } from "@/features/highlights/HighlightsMasonry";
import { allHighlightsKeys } from "@/features/highlights/use-all-highlights-query";
import { readingSessionKeys } from "@/hooks/use-reading-sessions-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { seedHighlightsPerformanceFixture } from "./fixture";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
});

const [groups] = await Promise.all([
  seedHighlightsPerformanceFixture(),
  document.fonts.load('400 18px "EB Garamond"'),
  document.fonts.load('500 44px "EB Garamond"'),
]);
queryClient.setQueryData(allHighlightsKeys.all, groups);
queryClient.setQueryData(readingSessionKeys.overview, {
  books: groups.map(({ book }) => book),
  sessions: [],
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HighlightsMasonry />
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
