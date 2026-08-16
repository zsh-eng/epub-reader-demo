import { AppSidebar } from "@/components/AppSidebar";
import {
  SidebarFloatingTrigger,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

const AppShellReadinessContext = createContext<
  ((ready: boolean) => void) | null
>(null);

export function useAppShellReady(ready: boolean): void {
  const reportReady = useContext(AppShellReadinessContext);

  useLayoutEffect(() => {
    if (ready) reportReady?.(true);
  }, [ready, reportReady]);
}

/**
 * Persistent product shell. The sidebar always floats above the active screen,
 * so opening navigation never changes page or pagination width.
 */
export function AppShell() {
  const location = useLocation();
  const { isLoading: isAuthLoading } = useAuth();
  const isReaderRoute = location.pathname.startsWith("/reader/");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [libraryReady, setLibraryReady] = useState(location.pathname !== "/");
  const canReveal =
    isReaderRoute ||
    (!isAuthLoading && (location.pathname !== "/" || libraryReady));
  const [hasRevealed, setHasRevealed] = useState(canReveal);

  useLayoutEffect(() => {
    if (canReveal) setHasRevealed(true);
  }, [canReveal]);

  return (
    <AppShellReadinessContext.Provider value={setLibraryReady}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className={cn("bg-background", !hasRevealed && "invisible")}
        aria-hidden={!hasRevealed}
      >
        <AppSidebar />
        <SidebarFloatingTrigger />
        <SidebarInset
          className={cn(
            isReaderRoute
              ? "h-dvh min-h-0 overflow-hidden"
              : "min-h-svh overflow-hidden",
          )}
        >
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </AppShellReadinessContext.Provider>
  );
}
