import BouncyButton from "@/components/bouncy-button";
import { cn } from "@/lib/utils";
import { Image } from "lucide-react";
import { Link } from "react-router";

export function ImagesLinkButton() {
  return (
    <Link to="/images">
      <BouncyButton
        variant="large"
        asButton={true}
        className={cn(
          "bg-background dark:bg-muted/50 w-full rounded-xl py-4 px-6  cursor-pointer transition-all duration-100 ease-out",
        )}
      >
        <div className="flex justify-between">
          <span>Images</span>
          <Image className="w-6 h-6 text-muted-foreground" />
        </div>
      </BouncyButton>
    </Link>
  );
}
