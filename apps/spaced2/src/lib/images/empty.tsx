import { WifiOff } from "lucide-react";

export default function EmptyImages() {
  return (
    <div className="flex flex-col items-center justify-center col-span-3 h-80 gap-6">
      <WifiOff className="h-16 w-16 text-muted-foreground" />
      <div className="text-muted-foreground w-60 text-sm text-center">
        No images available offline
      </div>
    </div>
  );
}
