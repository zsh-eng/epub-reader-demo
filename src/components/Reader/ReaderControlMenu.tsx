import { List, Search, Settings, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { ReaderSheet } from "./shared/ReaderSheet";

interface ReaderControlMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

type MenuItemId = "contents" | "search" | "settings";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "contents", label: "Contents", icon: List },
  { id: "search", label: "Search Book", icon: Search },
  { id: "settings", label: "Themes & Settings", icon: Settings },
];

export function ReaderControlMenu({
  isOpen,
  onClose,
  onOpenSettings,
}: ReaderControlMenuProps) {
  const handleRowClick = (id: MenuItemId) => {
    if (id === "settings") {
      onClose();
      onOpenSettings();
    } else {
      onClose();
    }
  };

  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Reader Tools"
      panelClassName="max-w-md"
    >
      <div className="px-4 pb-1">
        <div className="flex flex-col gap-2">
          {MENU_ITEMS.map((item, index) => (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{
                duration: 0.2,
                ease: [0.16, 1, 0.3, 1],
                delay: index * 0.06,
              }}
              className="flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left transition-colors hover:bg-secondary/55"
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
    </ReaderSheet>
  );
}
