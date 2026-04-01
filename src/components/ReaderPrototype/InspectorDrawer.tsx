import { Drawer, DrawerContent } from "@/components/ui/drawer";
import type { ReactNode } from "react";

interface InspectorDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function InspectorDrawer({
  open,
  onOpenChange,
  children,
}: InspectorDrawerProps) {
  return (
    <Drawer direction="bottom" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <div className="overflow-y-auto px-4 pb-6 pt-2">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
