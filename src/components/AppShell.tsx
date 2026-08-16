import { AppSidebar } from "@/components/AppSidebar";
import {
  SidebarFloatingTrigger,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { useLocation, useOutlet } from "react-router-dom";

const ROUTE_CROSSFADE_DURATION_SECONDS = 0.18;
const REDUCED_ROUTE_CROSSFADE_DURATION_SECONDS = 0.1;
const ROUTE_EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

function getRouteTransitionKey(pathname: string): string {
  // A book change is navigation within the Reader, not a new product screen.
  if (pathname.startsWith("/reader/")) return "/reader";
  if (pathname === "/sessions") return "/devices";
  return pathname;
}

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
  const outlet = useOutlet();
  const prefersReducedMotion = useReducedMotion();
  const { isLoading: isAuthLoading } = useAuth();
  const isReaderRoute = location.pathname.startsWith("/reader/");
  const routeTransitionKey = getRouteTransitionKey(location.pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [libraryReady, setLibraryReady] = useState(location.pathname !== "/");
  const [readyLocationKey, setReadyLocationKey] = useState(() =>
    location.pathname === "/" ? "" : location.key,
  );
  const canReveal =
    isReaderRoute ||
    (!isAuthLoading && (location.pathname !== "/" || libraryReady));
  const [hasRevealed, setHasRevealed] = useState(canReveal);
  // On the initial Library load, keep the complete page transparent until the
  // shell and the Library readiness gate are both open. This preserves the
  // atomic reveal while allowing the finished surface to fade in once.
  const routeContentReady =
    location.pathname !== "/" ||
    (hasRevealed && readyLocationKey === location.key);

  const handleRouteReady = useCallback(
    (ready: boolean) => {
      if (!ready) return;
      setLibraryReady(true);
      setReadyLocationKey(location.key);
    },
    [location.key],
  );

  useLayoutEffect(() => {
    if (canReveal) setHasRevealed(true);
  }, [canReveal]);

  return (
    <AppShellReadinessContext.Provider value={handleRouteReady}>
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
              : "min-h-svh overflow-x-clip",
          )}
        >
          <div className="grid min-h-0 flex-1">
            <AnimatePresence initial={false} mode="sync">
              <motion.div
                key={routeTransitionKey}
                className="col-start-1 row-start-1 min-h-0 min-w-0"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: routeContentReady ? 1 : 0,
                  transition: {
                    duration: prefersReducedMotion
                      ? REDUCED_ROUTE_CROSSFADE_DURATION_SECONDS
                      : ROUTE_CROSSFADE_DURATION_SECONDS,
                    ease: ROUTE_EASE_IN_OUT,
                  },
                }}
                exit={{
                  opacity: 0,
                  transition: {
                    duration: prefersReducedMotion
                      ? REDUCED_ROUTE_CROSSFADE_DURATION_SECONDS
                      : ROUTE_CROSSFADE_DURATION_SECONDS,
                    ease: ROUTE_EASE_IN_OUT,
                  },
                }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AppShellReadinessContext.Provider>
  );
}
