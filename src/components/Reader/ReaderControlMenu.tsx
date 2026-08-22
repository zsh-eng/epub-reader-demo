import { cn } from "@/lib/utils";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import {
  ClipboardCopy,
  List,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

interface ReaderControlMenuProps {
  onOpenContents: () => void;
  onOpenSettings: () => void;
  onCopyDebugDump?: () => void;
}

type MenuItemId = "contents" | "search" | "settings" | "debug-dump";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  isAvailable: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "contents", label: "Contents", icon: List, isAvailable: true },
  { id: "search", label: "Search Book", icon: Search, isAvailable: false },
  {
    id: "settings",
    label: "Themes & Settings",
    icon: Settings,
    isAvailable: true,
  },
  {
    id: "debug-dump",
    label: "Copy Debug Dump",
    icon: ClipboardCopy,
    isAvailable: true,
  },
];

function ReaderControlMenuItem({
  item,
  index,
  disabled,
  onClick,
}: {
  item: MenuItem;
  index: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const springPress = useSpringPressAnimation();

  return (
    <motion.div
      initial={{ opacity: 0, transform: "translateY(16px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "translateY(16px)" }}
      transition={{
        duration: 0.2,
        ease: [0.16, 1, 0.3, 1],
        delay: index * 0.06,
      }}
    >
      <motion.button
        type="button"
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left transition-colors",
          disabled ? "cursor-not-allowed opacity-60" : "hover:bg-secondary/55",
        )}
        onClick={onClick}
        {...springPress}
      >
        <div className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="mt-1 block truncate text-sm font-medium text-foreground">
            {item.label}
          </span>
        </div>
        <item.icon className="size-4 text-muted-foreground" />
      </motion.button>
    </motion.div>
  );
}

export function ReaderControlMenu({
  onOpenContents,
  onOpenSettings,
  onCopyDebugDump,
}: ReaderControlMenuProps) {
  const handleRowClick = (id: MenuItemId) => {
    if (id === "contents") {
      onOpenContents();
      return;
    }

    if (id === "settings") {
      onOpenSettings();
      return;
    }

    if (id === "debug-dump") {
      onCopyDebugDump?.();
    }
  };

  return (
    <div
      className="px-4 py-3"
      style={{
        paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
      }}
    >
      <div className="flex flex-col gap-2">
        {MENU_ITEMS.map((item, index) => {
          const isDisabled =
            !item.isAvailable || (item.id === "debug-dump" && !onCopyDebugDump);

          return (
            <ReaderControlMenuItem
              key={item.id}
              item={item}
              index={index}
              disabled={isDisabled}
              onClick={() => handleRowClick(item.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
