import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppMobileNavigationSheets } from "@/components/AppMobileNavigationSheets";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth-client";
import type { SyncedBook } from "@/lib/db";
import { findMostRecentlyReadBook } from "@/lib/library-sort";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  BookOpenText,
  Clock3,
  Cloud,
  CloudOff,
  Highlighter,
  Library,
  Loader2,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Moon,
  MoreVertical,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface ContinueReadingCardProps {
  book: SyncedBook;
  coverUrl: string | undefined;
  isActive: boolean;
  lastRead: number;
}

/**
 * A quiet resume destination. The cover wash adds identity, while the sharp
 * thumbnail and sidebar-toned gradient keep arbitrary cover art legible.
 */
function ContinueReadingCard({
  book,
  coverUrl,
  isActive,
  lastRead,
}: ContinueReadingCardProps) {
  const activityLabel = isActive
    ? "Reading now"
    : `Last read ${formatDistanceToNow(new Date(lastRead), {
        addSuffix: true,
      })}`;

  return (
    <div className="px-1">
      <p className="mb-2 px-1 text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/45">
        Continue reading
      </p>
      <Link
        to={`/reader/${book.id}`}
        aria-label={`Continue reading ${book.title}`}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group relative flex min-h-[80px] w-full overflow-hidden rounded-xl border border-sidebar-border/80 bg-sidebar-accent/35 p-2.5 text-sidebar-foreground outline-none transition-[transform,border-color,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.985] motion-reduce:active:scale-100",
          "hover:border-sidebar-foreground/15 hover:bg-sidebar-accent/55",
          isActive && "border-sidebar-foreground/20 bg-sidebar-accent/65",
        )}
        title={`Continue reading ${book.title}`}
      >
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-30 blur-lg saturate-75"
          />
        )}
        <span
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-sidebar via-sidebar/90 to-sidebar/65"
          aria-hidden="true"
        />

        <span className="relative flex min-w-0 items-center gap-2.5">
          <span className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-sidebar-border/80 bg-sidebar-accent shadow-sm">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                aria-hidden="true"
                className="size-full object-cover"
              />
            ) : (
              <BookOpenText
                className="size-4 text-sidebar-foreground/45"
                aria-hidden="true"
              />
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 font-serif text-[13px] font-medium leading-[17px] tracking-[-0.01em]">
              {book.title}
            </span>
            <span className="mt-1 block truncate text-[11px] leading-4 text-sidebar-foreground/55">
              {activityLabel}
            </span>
          </span>
        </span>
      </Link>
    </div>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { settings, updateSettings } = useReaderSettings();
  const { isSyncing, triggerSync } = useSync();
  const { data: booksData, refetch: refetchBooks } = useBooksWithStatuses();
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const recentReading = useMemo(() => {
    if (!booksData) return null;
    return findMostRecentlyReadBook(booksData.books, booksData.lastReadByBook);
  }, [booksData]);
  const recentBooks = useMemo(
    () => (recentReading ? [recentReading.book] : []),
    [recentReading],
  );
  const { coverUrls } = useLibraryCoverUrls(recentBooks);
  const isSidebarOpen = isMobile ? openMobile : open;
  const recentBookCoverUrl = recentReading
    ? coverUrls.get(recentReading.book.id)
    : undefined;

  const isDarkTheme =
    settings.theme === "dark" || settings.theme === "flexoki-dark";

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;
    void refetchBooks();
  }, [isSidebarOpen, refetchBooks]);

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, location.pathname, setOpenMobile]);

  const closeSidebar = () => {
    setOpen(false);
    setOpenMobile(false);
  };

  const handleThemeToggle = () => {
    const nextTheme = {
      "flexoki-light": "flexoki-dark",
      "flexoki-dark": "flexoki-light",
      light: "dark",
      dark: "light",
    }[settings.theme] as typeof settings.theme | undefined;

    updateSettings({ theme: nextTheme ?? (isDarkTheme ? "light" : "dark") });
  };

  const handleSync = async () => {
    try {
      await triggerSync();
      toast({ title: "Library synced" });
    } catch (error) {
      console.error("Error syncing:", error);
      toast({
        title: "Sync failed",
        description: "Failed to synchronize library",
        variant: "destructive",
      });
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
    } catch (error) {
      console.error("Error signing in:", error);
      toast({
        title: "Error",
        description: "Failed to sign in with Google",
        variant: "destructive",
      });
    }
  };

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      closeSidebar();
      navigate("/");
      toast({
        title: "Signed out",
        description: "You have been signed out successfully",
      });
    } catch (error) {
      console.error("Error signing out:", error);
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      });
    }
  };

  if (isMobile) {
    return (
      <AppMobileNavigationSheets
        isOpen={openMobile}
        onClose={() => setOpenMobile(false)}
        activePath={location.pathname}
        recentReading={recentReading}
        recentBookCoverUrl={recentBookCoverUrl}
        isDarkTheme={isDarkTheme}
        onThemeToggle={handleThemeToggle}
        isOnline={isOnline}
        isSyncing={isSyncing}
        onSync={handleSync}
        isAuthenticated={isAuthenticated}
        isAuthLoading={isAuthLoading}
        user={user ?? null}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-3 pt-3 pb-1">
        <div className="flex h-[38px] items-center">
          <Link
            to="/"
            className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 outline-none hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            title="Go to library"
          >
            <BookOpenText
              className="size-[17px] shrink-0 text-sidebar-foreground/70"
              aria-hidden="true"
            />
            <span className="truncate font-serif text-[16px] font-medium tracking-tight">
              Reader
            </span>
          </Link>
          <SidebarTrigger className="ml-auto size-7 rounded-full text-sidebar-foreground/50 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground" />
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/"}
                render={<Link to="/" />}
              >
                <Library />
                <span>Library</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/highlights"}
                render={<Link to="/highlights" />}
              >
                <Highlighter />
                <span>Highlights</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/reading-sessions"}
                render={<Link to="/reading-sessions" />}
              >
                <Clock3 />
                <span>Sessions</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {recentReading && (
            <>
              <SidebarSeparator className="my-3" />
              <ContinueReadingCard
                book={recentReading.book}
                coverUrl={recentBookCoverUrl}
                lastRead={recentReading.lastRead}
                isActive={
                  location.pathname === `/reader/${recentReading.book.id}`
                }
              />
            </>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-3 pt-2 pb-3">
        <SidebarSeparator className="mb-1" />
        <SidebarMenu className="pt-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleThemeToggle}
              aria-label={
                isDarkTheme ? "Switch to light theme" : "Switch to dark theme"
              }
            >
              {isDarkTheme ? <Sun /> : <Moon />}
              <span>Toggle theme</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {isAuthenticated && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => void handleSync()}
                disabled={isSyncing || !isOnline}
              >
                {isSyncing ? (
                  <Loader2 className="animate-spin" />
                ) : isOnline ? (
                  <Cloud />
                ) : (
                  <CloudOff />
                )}
                <span>
                  {isSyncing ? "Syncing…" : isOnline ? "Sync now" : "Offline"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>

        <SidebarSeparator className="my-1" />

        {isAuthLoading ? (
          <div className="flex h-13 items-center gap-2.5 px-2.5">
            <Skeleton className="size-8 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ) : isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                />
              }
            >
              <Avatar className="size-8">
                <AvatarImage
                  src={user.image || undefined}
                  alt={user.name || "User"}
                />
                <AvatarFallback className="text-xs">
                  {getUserInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium leading-[18px]"
                  title={user.name}
                >
                  {user.name}
                </span>
                <span className="block truncate text-xs leading-[18px] text-sidebar-foreground/60">
                  {user.email}
                </span>
              </span>
              <MoreVertical className="size-3.5 shrink-0 text-sidebar-foreground/45" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuItem render={<Link to="/devices" />}>
                <MonitorSmartphone />
                Devices
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleSignOut()}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => void handleGoogleSignIn()}>
                <LogIn />
                <span>Sign in with Google</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
