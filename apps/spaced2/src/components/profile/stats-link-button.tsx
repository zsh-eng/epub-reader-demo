import BouncyButton from "@/components/bouncy-button";
import { cn } from "@/lib/utils";
import { BarChart } from "lucide-react";
import { Link } from "react-router";

export function StatsLinkButton() {
  return (
    <Link to="/stats">
      <BouncyButton
        variant="large"
        asButton={true}
        className={cn(
          "bg-background dark:bg-muted/50 w-full rounded-xl py-4 px-6  cursor-pointer transition-all duration-100 ease-out",
        )}
      >
        <div className="flex justify-between">
          <span>Stats</span>
          <BarChart className="w-6 h-6 text-muted-foreground" />
        </div>
      </BouncyButton>
    </Link>
  );
}
