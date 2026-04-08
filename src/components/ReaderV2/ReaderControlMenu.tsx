import { List, Search, Settings, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="control-menu"
          className="fixed inset-0 z-30 flex items-end justify-center px-3 sm:px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            onClick={onClose}
            aria-label="Close menu"
          />

          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 28, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-md rounded-t-[1.75rem] border border-border/70 bg-background/95 px-4 pt-3 backdrop-blur-xl"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 2rem)" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border/80" />
            <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Reader Tools
            </p>

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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
