import "@/App.css";
import { Highlights } from "@/components/Highlights";
import { LegacyReader } from "@/components/LegacyReader";
import { Library } from "@/components/Library";
import { Reader } from "@/components/Reader";
import { ReaderDebug } from "@/components/Reader/debug";
import { ReloadPrompt } from "@/components/ReloadPrompt";
import { Sessions } from "@/components/Sessions";
import { TocExplorationsRoute } from "@/components/TocExplorationsRoute";
import { Toaster } from "@/components/ui/sonner";
import { useSync } from "@/hooks/use-sync";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient();

/**
 * Component that initializes sync service.
 * Must be inside QueryClientProvider to access the query client.
 */
function SyncInitializer({ children }: { children: React.ReactNode }) {
  // Initialize sync service - this starts periodic sync when authenticated
  useSync();
  // Initialize transfer queue - this pauses/resumes based on auth state
  useTransferQueue();
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SyncInitializer>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/reader-legacy/:bookId" element={<LegacyReader />} />
            <Route path="/reader-v1/:bookId" element={<LegacyReader />} />
            <Route path="/reader/:bookId" element={<Reader />} />
            <Route path="/reader/debug/:bookId" element={<ReaderDebug />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/highlights" element={<Highlights />} />
            <Route path="/explorations/toc" element={<TocExplorationsRoute />} />
          </Routes>
          <Toaster
            position="top-right"
            toastOptions={{
              classNames: {
                toast: "!rounded-2xl",
              },
            }}
          />
          <ReloadPrompt />
        </BrowserRouter>
      </SyncInitializer>
    </QueryClientProvider>
  );
}

export default App;
