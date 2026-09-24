import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tv } from "lucide-react";

export default function OfflineUsageDialog() {
  return (
    <div className="flex flex-col items-center gap-2 my-4">
      <Tv className="w-8 h-8 text-muted-foreground" />
      <div className="text-center text-muted-foreground text-sm">
        <p>You're currently offline.</p>
        <Dialog>
          <DialogTrigger className="text-blue-500 text-sm cursor-pointer">
            What can I do?
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Offline Mode</DialogTitle>
              <DialogDescription>
                spaced is designed to work both online and offline.
                <br />
                While offline, you can still review your cards, update them and
                manage your decks. Your progress is saved locally on your
                device. Any changes you make will sync when you're back online.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
