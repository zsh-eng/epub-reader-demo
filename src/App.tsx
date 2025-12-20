import "@/App.css";
import { Library } from "@/components/Library";
import { Reader } from "@/components/Reader";
import { ReloadPrompt } from "@/components/ReloadPrompt";
import { Sessions } from "@/components/Sessions";
import { Toaster } from "@/components/ui/sonner";
import { useSync } from "@/hooks/use-sync";
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
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SyncInitializer>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/reader/:bookId" element={<Reader />} />
            <Route path="/sessions" element={<Sessions />} />
          </Routes>
          <Toaster />
          <ReloadPrompt />
        </BrowserRouter>
      </SyncInitializer>
    </QueryClientProvider>
  );
}

export default App;
