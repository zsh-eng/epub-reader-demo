import "@/App.css";
import { AppShell } from "@/components/AppShell";
import { HighlightsMasonry } from "@/features/highlights/HighlightsMasonry";
import { Library } from "@/features/library/Library";
import { Reader } from "@/components/Reader";
import { ReaderDebug } from "@/components/Reader/debug";
import { ReaderDiagnostics } from "@/components/Reader/diagnostics/ReaderDiagnostics";
import { ReadingSessions } from "@/components/ReadingSessions";
import { ReaderTraceViewer } from "@/components/ReaderTraceViewer";
import { ReloadPrompt } from "@/components/ReloadPrompt";
import { Devices } from "@/features/devices/Devices";
import { Toaster } from "@/components/ui/sonner";
import { EpubImportProvider } from "@/features/library/use-epub-import";
import { ReaderSettingsProvider } from "@/hooks/use-reader-settings";
import { SyncProvider } from "@/hooks/use-sync";
import { useFileUploads } from "@/hooks/use-file-uploads";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient();

/**
 * Starts durable file uploads once for the mounted application.
 */
function FileUploadInitializer({ children }: { children: React.ReactNode }) {
  useFileUploads();
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReaderSettingsProvider>
        <SyncProvider>
          <FileUploadInitializer>
            <BrowserRouter>
              <EpubImportProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<Library />} />
                    <Route path="/reader/:bookId" element={<Reader />} />
                    <Route path="/highlights" element={<HighlightsMasonry />} />
                    <Route path="/devices" element={<Devices />} />
                    <Route
                      path="/reading-sessions"
                      element={<ReadingSessions />}
                    />
                    <Route
                      path="/reader-traces"
                      element={<ReaderTraceViewer />}
                    />
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
          </FileUploadInitializer>
        </SyncProvider>
      </ReaderSettingsProvider>
    </QueryClientProvider>
  );
}

export default App;
