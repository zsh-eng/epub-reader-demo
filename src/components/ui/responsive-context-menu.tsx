"use client";

import * as React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  LongPressMenu,
  LongPressMenuContent,
  LongPressMenuItem,
  LongPressMenuItems,
  LongPressMenuSeparator,
  LongPressMenuTrigger,
} from "@/components/ui/long-press-menu";

// ============================================================================
// Hook to detect touch device
// ============================================================================

function useIsTouchDevice() {
  const [isTouch, setIsTouch] = React.useState(false);

  React.useEffect(() => {
    // Check for touch capability
    const checkTouch = () => {
      setIsTouch(
        "ontouchstart" in window ||
          navigator.maxTouchPoints > 0 ||
          // @ts-expect-error - msMaxTouchPoints is IE-specific
          navigator.msMaxTouchPoints > 0,
      );
    };

    checkTouch();
    // Re-check on resize (hybrid devices may change modes)
    window.addEventListener("resize", checkTouch);
    return () => window.removeEventListener("resize", checkTouch);
  }, []);

  return isTouch;
}

// ============================================================================
// Context for sharing menu items between mobile and desktop
// ============================================================================

interface MenuItemConfig {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface ResponsiveContextMenuContextValue {
  items: MenuItemConfig[];
  separatorIndices: number[];
}

const ResponsiveContextMenuContext =
  React.createContext<ResponsiveContextMenuContextValue | null>(null);

// ============================================================================
// Root Component
// ============================================================================

interface ResponsiveContextMenuProps {
  children: React.ReactNode;
}

function ResponsiveContextMenuRoot({ children }: ResponsiveContextMenuProps) {
  const isTouch = useIsTouchDevice();

  const { items, separatorIndices, trigger } = React.useMemo(() => {
    const newItems: MenuItemConfig[] = [];
    const newSeparatorIndices: number[] = [];
    let newTrigger: React.ReactNode = null;

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;

      const displayName = (child.type as React.ComponentType)?.displayName;
      if (displayName === "ResponsiveContextMenuTrigger") {
        newTrigger = (child.props as { children: React.ReactNode }).children;
        return;
      }

      if (displayName === "ResponsiveContextMenuContent") {
        const contentProps = child.props as { children: React.ReactNode };
        React.Children.forEach(contentProps.children, (item) => {
          if (!React.isValidElement(item)) return;

          const displayName = (item.type as React.ComponentType)?.displayName;

          if (displayName === "ResponsiveContextMenuItem") {
            const itemProps = item.props as ResponsiveContextMenuItemProps;
            newItems.push({
              label: itemProps.children,
              icon: itemProps.icon,
              onClick: itemProps.onClick,
              destructive: itemProps.destructive,
              disabled: itemProps.disabled,
            });
          } else if (displayName === "ResponsiveContextMenuSeparator") {
            newSeparatorIndices.push(newItems.length);
          }
        });
      }
    });

    return {
      items: newItems,
      separatorIndices: newSeparatorIndices,
      trigger: newTrigger,
    };
  }, [children]);

  if (isTouch) {
    // Mobile: Use LongPressMenu with backdrop
    return (
      <ResponsiveContextMenuContext.Provider
        value={{ items, separatorIndices }}
      >
        <LongPressMenu>
          <LongPressMenuTrigger>{trigger}</LongPressMenuTrigger>
          <LongPressMenuContent>
            <LongPressMenuItems>
              {items.map((item, index) => (
                <React.Fragment key={index}>
                  {separatorIndices.includes(index) && (
                    <LongPressMenuSeparator />
                  )}
                  <LongPressMenuItem
                    onClick={item.onClick}
                    destructive={item.destructive}
                    disabled={item.disabled}
                  >
                    {item.icon}
                    {item.label}
                  </LongPressMenuItem>
                </React.Fragment>
              ))}
            </LongPressMenuItems>
          </LongPressMenuContent>
        </LongPressMenu>
      </ResponsiveContextMenuContext.Provider>
    );
  }

  // Desktop: Use Radix ContextMenu
  return (
    <ResponsiveContextMenuContext.Provider value={{ items, separatorIndices }}>
      <ContextMenu>
        <ContextMenuTriggerWrapper>{trigger}</ContextMenuTriggerWrapper>
        <ContextMenuContent className="w-[200px]">
          {items.map((item, index) => (
            <React.Fragment key={index}>
              {separatorIndices.includes(index) && <ContextMenuSeparator />}
              <ContextMenuItem
                onClick={item.onClick}
                disabled={item.disabled}
                variant={item.destructive ? "destructive" : "default"}
                className="gap-2"
              >
                {item.icon}
                {item.label}
              </ContextMenuItem>
            </React.Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </ResponsiveContextMenuContext.Provider>
  );
}

// ============================================================================
// Context Menu Trigger Wrapper (for Radix)
// ============================================================================

import { ContextMenuTrigger } from "@/components/ui/context-menu";

function ContextMenuTriggerWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>;
}

// ============================================================================
// Trigger Component (declarative API)
// ============================================================================

interface ResponsiveContextMenuTriggerProps {
  children: React.ReactNode;
  className?: string;
}

function ResponsiveContextMenuTrigger({
  children,
  className,
}: ResponsiveContextMenuTriggerProps) {
  // This is a declarative component - its children are extracted by the Root
  return <div className={className}>{children}</div>;
}
ResponsiveContextMenuTrigger.displayName = "ResponsiveContextMenuTrigger";

// ============================================================================
// Content Component (declarative API)
// ============================================================================

interface ResponsiveContextMenuContentProps {
  children: React.ReactNode;
}

function ResponsiveContextMenuContent(
  _props: ResponsiveContextMenuContentProps,
) {
  // This is a declarative component - its children are extracted by the Root
  return null;
}
ResponsiveContextMenuContent.displayName = "ResponsiveContextMenuContent";

// ============================================================================
// Item Component (declarative API)
// ============================================================================

interface ResponsiveContextMenuItemProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

function ResponsiveContextMenuItem(_props: ResponsiveContextMenuItemProps) {
  // This is a declarative component - props are extracted by the Root
  return null;
}
ResponsiveContextMenuItem.displayName = "ResponsiveContextMenuItem";

// ============================================================================
// Separator Component (declarative API)
// ============================================================================

function ResponsiveContextMenuSeparator() {
  // This is a declarative component - position is tracked by the Root
  return null;
}
ResponsiveContextMenuSeparator.displayName = "ResponsiveContextMenuSeparator";

// ============================================================================
// Exports
// ============================================================================

export {
  ResponsiveContextMenuRoot as ResponsiveContextMenu,
  ResponsiveContextMenuTrigger,
  ResponsiveContextMenuContent,
  ResponsiveContextMenuItem,
  ResponsiveContextMenuSeparator,
};
