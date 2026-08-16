import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { PanelLeftIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
} from "react";

const SIDEBAR_WIDTH = "18rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_TRANSITION_MS = 160;

type RenderProp = Parameters<typeof useRender>[0]["render"];

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}

interface SidebarProviderProps extends ComponentProps<"div"> {
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Owns the shared desktop/mobile sidebar state and the Command/Ctrl+Backslash
 * shortcut. The desktop state can be controlled by the route-aware app shell.
 */
export function SidebarProvider({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  style,
  ...props
}: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) {
        onOpenChange(nextOpen);
        return;
      }
      setUncontrolledOpen(nextOpen);
    },
    [onOpenChange],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
      return;
    }
    setOpen(!open);
  }, [isMobile, open, setOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.code !== "Backslash" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      toggleSidebar();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        data-sidebar-open={open}
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-transition-ms": `${SIDEBAR_TRANSITION_MS}ms`,
            ...style,
          } as CSSProperties
        }
        className={cn("flex min-h-svh w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: ComponentProps<"aside">) {
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Drawer direction="left" open={openMobile} onOpenChange={setOpenMobile}>
        <DrawerContent
          data-slot="sidebar"
          className="inset-y-3! left-3! h-auto! w-[calc(100vw-1.5rem)]! max-w-(--sidebar-width)! gap-0 rounded-2xl border border-sidebar-border/80 bg-sidebar/96 p-0 text-sidebar-foreground shadow-2xl backdrop-blur-xl transition-[opacity,transform] duration-[160ms]! ease-[cubic-bezier(0.22,1,0.36,1)]! data-[starting-style]:translate-x-[-12px]! data-[starting-style]:opacity-0 data-[ending-style]:translate-x-[-12px]! data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]!"
          overlayClassName="bg-background/15 backdrop-blur-[1px] duration-[160ms]! data-[ending-style]:duration-[120ms]!"
          style={{ "--sidebar-width": SIDEBAR_WIDTH_MOBILE } as CSSProperties}
        >
          <div className="sr-only">
            <DrawerTitle>Application navigation</DrawerTitle>
            <DrawerDescription>
              Navigate the reader and manage application actions.
            </DrawerDescription>
          </div>
          <div className="flex h-full min-h-0 flex-col">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <aside
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={cn(
        "pointer-events-none fixed inset-0 z-40 hidden text-sidebar-foreground md:block",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-label="Close sidebar"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-transparent",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "pointer-events-auto fixed inset-y-3 left-3 z-50 flex w-(--sidebar-width) transition-[opacity,transform] duration-(--sidebar-transition-ms) ease-[cubic-bezier(0.22,1,0.36,1)]",
          open
            ? "translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-3 opacity-0",
        )}
      >
        <div
          data-slot="sidebar-inner"
          className="flex h-full min-h-0 w-full flex-col rounded-2xl border border-sidebar-border/80 bg-sidebar/96 text-sidebar-foreground shadow-2xl backdrop-blur-xl"
        >
          {children}
        </div>
      </div>
    </aside>
  );
}

export function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-w-0 flex-1 flex-col bg-background",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0", className)}
      aria-label="Toggle sidebar"
      aria-expanded={isMobile ? openMobile : open}
      title="Toggle sidebar (Command or Control + Backslash)"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon className="size-4" />
    </Button>
  );
}

export function SidebarFloatingTrigger({ className }: { className?: string }) {
  const { isMobile, open, openMobile } = useSidebar();
  const isSidebarOpen = isMobile ? openMobile : open;

  return (
    <div
      aria-hidden={isSidebarOpen}
      className={cn(
        "fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-30 transition-[opacity,transform] duration-150 ease-out",
        isSidebarOpen
          ? "pointer-events-none invisible -translate-y-1 opacity-0"
          : "translate-y-0 opacity-65 hover:opacity-100",
        className,
      )}
    >
      <SidebarTrigger
        tabIndex={isSidebarOpen ? -1 : 0}
        className="size-9 rounded-full border border-border/60 bg-background/75 text-muted-foreground shadow-sm backdrop-blur-xl hover:bg-background/95 hover:text-foreground"
      />
    </div>
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-auto p-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  );
}

interface SidebarMenuButtonProps extends ComponentProps<"button"> {
  isActive?: boolean;
  render?: RenderProp;
}

export function SidebarMenuButton({
  isActive = false,
  render,
  className,
  ...props
}: SidebarMenuButtonProps) {
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps(
      {
        "data-slot": "sidebar-menu-button",
        "data-active": isActive,
        type: "button",
        className: cn(
          "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] font-normal outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
          className,
        ),
      },
      props,
    ),
  });
}

export function SidebarSeparator({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      className={cn("bg-sidebar-border", className)}
      {...props}
    />
  );
}
