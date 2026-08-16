import "@/App.css";
import { AppShell } from "@/components/AppShell";
import { Highlights } from "@/components/Highlights";
import { Library } from "@/components/Library";
import { Reader } from "@/components/Reader";
import { ReaderDebug } from "@/components/Reader/debug";
import { ReaderDiagnostics } from "@/components/Reader/diagnostics/ReaderDiagnostics";
import { ReloadPrompt } from "@/components/ReloadPrompt";
import { Devices } from "@/components/Sessions";
import { ReadingSessionsDebug } from "@/components/debug/ReadingSessionsDebug";
import { Toaster } from "@/components/ui/sonner";
import { EpubImportProvider } from "@/hooks/use-epub-import";
import { ReaderSettingsProvider } from "@/hooks/use-reader-settings";
import { SyncProvider } from "@/hooks/use-sync";
import { useTransferQueue } from "@/hooks/use-transfer-queue";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient();

/**
 * Starts the file transfer queue once for the mounted application.
 */
function TransferQueueInitializer({ children }: { children: React.ReactNode }) {
  useTransferQueue();
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReaderSettingsProvider>
        <SyncProvider>
          <TransferQueueInitializer>
            <BrowserRouter>
              <EpubImportProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<Library />} />
                    <Route path="/reader/:bookId" element={<Reader />} />
                    <Route path="/highlights" element={<Highlights />} />
                    <Route path="/devices" element={<Devices />} />
                    <Route
                      path="/sessions"
                      element={<Navigate to="/devices" replace />}
                    />
                  </Route>
                  <Route
                    path="/debug/reader/:bookId"
                    element={<ReaderDebug />}
                  />
                  <Route
                    path="/diagnostics/reader"
                    element={<ReaderDiagnostics />}
                  />
                  <Route
                    path="/debug/reading-sessions"
                    element={<ReadingSessionsDebug />}
                  />
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
              </EpubImportProvider>
            </BrowserRouter>
          </TransferQueueInitializer>
        </SyncProvider>
      </ReaderSettingsProvider>
    </QueryClientProvider>
  );
}

export default App;
