import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { Outlet, useLocation } from "react-router-dom";

const STANDARD_SIDEBAR_STORAGE_KEY = "reader-sidebar-open";

const AppShellReadinessContext = createContext<
  ((ready: boolean) => void) | null
>(null);

export function useAppShellReady(ready: boolean): void {
  const reportReady = useContext(AppShellReadinessContext);

  useLayoutEffect(() => {
    if (ready) reportReady?.(true);
  }, [ready, reportReady]);
}

function getInitialStandardSidebarState(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STANDARD_SIDEBAR_STORAGE_KEY) !== "false";
}

/**
 * Persistent product shell. Normal pages reserve an inset for the sidebar;
 * Reader routes use the same sidebar as a floating overlay so pagination width
 * never changes when navigation opens.
 */
export function AppShell() {
  const location = useLocation();
  const { isLoading: isAuthLoading } = useAuth();
  const isReaderRoute = location.pathname.startsWith("/reader/");
  const [standardOpen, setStandardOpen] = useState(
    getInitialStandardSidebarState,
  );
  const [readerOpen, setReaderOpen] = useState(false);
  const [libraryReady, setLibraryReady] = useState(location.pathname !== "/");
  const canReveal =
    isReaderRoute ||
    (!isAuthLoading && (location.pathname !== "/" || libraryReady));
  const [hasRevealed, setHasRevealed] = useState(canReveal);

  useEffect(() => {
    if (isReaderRoute) setReaderOpen(false);
  }, [isReaderRoute, location.pathname]);

  useLayoutEffect(() => {
    if (canReveal) setHasRevealed(true);
  }, [canReveal]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isReaderRoute) {
        setReaderOpen(open);
        return;
      }

      setStandardOpen(open);
      window.localStorage.setItem(STANDARD_SIDEBAR_STORAGE_KEY, String(open));
    },
    [isReaderRoute],
  );

  const presentation = isReaderRoute ? "overlay" : "inset";

  return (
    <AppShellReadinessContext.Provider value={setLibraryReady}>
      <SidebarProvider
        open={isReaderRoute ? readerOpen : standardOpen}
        onOpenChange={handleOpenChange}
        className={cn(
          presentation === "inset" ? "bg-sidebar" : "bg-background",
          !hasRevealed && "invisible",
        )}
        aria-hidden={!hasRevealed}
      >
        <AppSidebar presentation={presentation} />
        <SidebarInset
          className={cn(
            isReaderRoute
              ? "h-dvh min-h-0 overflow-hidden"
              : "min-h-[calc(100svh-1rem)] overflow-hidden",
          )}
        >
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </AppShellReadinessContext.Provider>
  );
}
