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

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function AppSidebar() {
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

  const closeSidebar = () => {
    setOpen(false);
    setOpenMobile(false);
  };

  const handleImport = () => {
    closeSidebar();
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

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-4 pt-3.5 pb-2">
        <div className="flex h-9 items-center gap-2.5 px-0.5">
          <BookOpenText
            className="size-[17px] text-sidebar-foreground/70"
            aria-hidden="true"
          />
          <span className="font-serif text-[16px] italic tracking-tight">
            Reader
          </span>
          <SidebarTrigger className="ml-auto size-7 rounded-full text-sidebar-foreground/50 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-start rounded-lg border-sidebar-border/80 bg-background/45 px-3 text-[13px] font-normal shadow-none hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
          onClick={handleImport}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <BookPlus className="size-4" />
          )}
          {isProcessing ? "Importing…" : "Import EPUB"}
        </Button>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/"}
                render={<Link to="/" onClick={closeSidebar} />}
              >
                <Library />
                <span>Library</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/highlights"}
                render={<Link to="/highlights" onClick={closeSidebar} />}
              >
                <Highlighter />
                <span>Highlights</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {isAuthenticated && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/devices"}
                  render={<Link to="/devices" onClick={closeSidebar} />}
                >
                  <MonitorSmartphone />
                  <span>Devices</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-3 pt-2 pb-3">
        <SidebarSeparator className="mb-1" />
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
              <DropdownMenuItem
                render={
                  <Link to="/devices" onClick={closeSidebar}>
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
