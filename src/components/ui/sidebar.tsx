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

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_TRANSITION_MS = 120;

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
  defaultOpen = true,
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

interface SidebarProps extends ComponentProps<"aside"> {
  presentation?: "inset" | "overlay";
}

export function Sidebar({
  presentation = "inset",
  className,
  children,
  ...props
}: SidebarProps) {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Drawer direction="left" open={openMobile} onOpenChange={setOpenMobile}>
        <DrawerContent
          data-slot="sidebar"
          className="w-(--sidebar-width)! max-w-none! gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground duration-[120ms] data-[ending-style]:duration-[120ms]"
          overlayClassName="bg-black/35 duration-[120ms] data-[ending-style]:duration-[120ms]"
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

  const reservesSpace = presentation === "inset";

  return (
    <aside
      data-slot="sidebar"
      data-presentation={presentation}
      data-state={open ? "expanded" : "collapsed"}
      className={cn("peer hidden text-sidebar-foreground md:block", className)}
      {...props}
    >
      <div
        data-slot="sidebar-gap"
        aria-hidden="true"
        className={cn(
          "relative bg-transparent transition-[width] duration-(--sidebar-transition-ms) ease-out",
          reservesSpace && open ? "w-(--sidebar-width)" : "w-0",
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-svh w-(--sidebar-width) transition-transform duration-(--sidebar-transition-ms) ease-out",
          open ? "translate-x-0" : "-translate-x-full",
          presentation === "inset" ? "p-2" : "z-50 p-2",
        )}
      >
        <div
          data-slot="sidebar-inner"
          className={cn(
            "flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground",
            presentation === "overlay" &&
              "rounded-xl border border-sidebar-border shadow-xl",
          )}
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
        "md:peer-data-[presentation=inset]:m-2 md:peer-data-[presentation=inset]:ml-0 md:peer-data-[presentation=inset]:rounded-xl md:peer-data-[presentation=inset]:shadow-sm",
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
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0", className)}
      aria-label="Toggle sidebar"
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
          "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-[18px] [&>svg]:shrink-0",
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
