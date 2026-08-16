import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { useEpubImport } from "@/hooks/use-epub-import";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth-client";
import {
  BookOpenText,
  BookPlus,
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
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

interface AppSidebarProps {
  presentation: "inset" | "overlay";
}

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function AppSidebar({ presentation }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { settings, updateSettings } = useReaderSettings();
  const { isSyncing, triggerSync } = useSync();
  const { isProcessing, openFilePicker } = useEpubImport();
  const { setOpen, setOpenMobile } = useSidebar();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

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

  const closeMobileSidebar = () => setOpenMobile(false);

  const handleImport = () => {
    closeMobileSidebar();
    if (presentation === "overlay") setOpen(false);
    openFilePicker();
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
      closeMobileSidebar();
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

  return (
    <Sidebar presentation={presentation}>
      <SidebarHeader className="gap-3 px-4 pt-4">
        <div className="flex h-10 items-center gap-3 px-1">
          <BookOpenText className="size-5" aria-hidden="true" />
          <span className="text-[17px] font-semibold tracking-tight">
            Reader
          </span>
          <SidebarTrigger className="ml-auto" />
        </div>
        <Button
          type="button"
          className="h-10 w-full justify-start rounded-lg px-3 text-[15px]"
          onClick={handleImport}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="size-[18px] animate-spin" />
          ) : (
            <BookPlus className="size-[18px]" />
          )}
          {isProcessing ? "Importing…" : "Import EPUB"}
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/"}
                render={<Link to="/" onClick={closeMobileSidebar} />}
              >
                <Library />
                <span>Library</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/highlights"}
                render={<Link to="/highlights" onClick={closeMobileSidebar} />}
              >
                <Highlighter />
                <span>Highlights</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {isAuthenticated && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/devices"}
                  render={<Link to="/devices" onClick={closeMobileSidebar} />}
                >
                  <MonitorSmartphone />
                  <span>Devices</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu className="pt-1">
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleThemeToggle}>
              {isDarkTheme ? <Sun /> : <Moon />}
              <span>{isDarkTheme ? "Light theme" : "Dark theme"}</span>
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

        {isAuthLoading ? (
          <div className="flex h-14 items-center gap-3 px-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
        ) : isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                />
              }
            >
              <Avatar className="size-9">
                <AvatarImage
                  src={user.image || undefined}
                  alt={user.name || "User"}
                />
                <AvatarFallback className="text-sm">
                  {getUserInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium leading-5">
                  {user.name}
                </span>
                <span className="block truncate text-[13px] leading-5 text-sidebar-foreground/65">
                  {user.email}
                </span>
              </span>
              <MoreVertical className="size-4 shrink-0 text-sidebar-foreground/60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuItem
                render={
                  <Link to="/devices" onClick={closeMobileSidebar}>
                    <MonitorSmartphone />
                    Devices
                  </Link>
                }
              />
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
