import { List, Search, Settings, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface ReaderControlMenuProps {
  onOpenSettings: () => void;
}

type MenuItemId = "contents" | "search" | "settings";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  isAvailable: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "contents", label: "Contents", icon: List, isAvailable: false },
  { id: "search", label: "Search Book", icon: Search, isAvailable: false },
  { id: "settings", label: "Themes & Settings", icon: Settings, isAvailable: true },
];

export function ReaderControlMenu({ onOpenSettings }: ReaderControlMenuProps) {
  const handleRowClick = (id: MenuItemId) => {
    if (id !== "settings") return;
    onOpenSettings();
  };

  return (
    <div className="px-4 pb-3">
      <div className="flex flex-col gap-2">
        {MENU_ITEMS.map((item, index) => (
          <motion.button
            key={item.id}
            type="button"
            disabled={!item.isAvailable}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{
              duration: 0.2,
              ease: [0.16, 1, 0.3, 1],
              delay: index * 0.06,
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left transition-colors",
              item.isAvailable
                ? "hover:bg-secondary/55"
                : "cursor-not-allowed opacity-60",
            )}
            onClick={() => handleRowClick(item.id)}
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
        ))}
      </div>
    </div>
  );
}
