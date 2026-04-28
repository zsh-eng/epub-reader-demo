import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
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
        <ScrollArea
          className="px-4 pb-6 pt-2"
          viewportClassName="h-auto max-h-[calc(85vh-3rem)]"
        >
          {children}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
