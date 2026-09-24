import { BarChart3 } from "lucide-react";

export default function EmptyStats() {
  return (
    <div className="flex flex-col items-center justify-center h-[70dvh] gap-4 py-12">
      <BarChart3 className="w-24 h-24 text-primary" strokeWidth={1.5} />
      <div className="text-center">
        <h3 className="text-lg font-medium">No stats yet</h3>
        <p className="text-sm text-muted-foreground">
          Start reviewing cards to see your progress
        </p>
      </div>
    </div>
  );
}
