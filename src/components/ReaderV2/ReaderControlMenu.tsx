import { AnimatePresence, motion } from "motion/react";
import { List, Search, Settings, type LucideIcon } from "lucide-react";

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
          className="fixed inset-0 z-30"
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

          {/* Staggered pill rows */}
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 2rem)" }}
          >
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
                className="flex h-16 w-full items-center justify-between rounded-2xl bg-muted/90 px-5"
                onClick={() => handleRowClick(item.id)}
              >
                <span className="text-base font-medium">{item.label}</span>
                <item.icon className="size-5 text-muted-foreground" />
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
