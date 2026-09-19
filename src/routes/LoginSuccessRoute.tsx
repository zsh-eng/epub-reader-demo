import BouncyButton from "@/components/bouncy-button";
import { registerAndSync } from "@/lib/auth";
import { delayAfter } from "@/lib/utils";
import { RefreshCcw } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export default function LoginSuccessRoute() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full col-start-1 col-end-13 xl:col-start-3 xl:col-end-11 md:px-24 pb-6 gap-2 animate-fade-in">
      <div className="flex flex-col items-center justify-center h-[70dvh] gap-4 py-12">
        {
          <>
            <button
              type="button"
              aria-label="Sync account data"
              onClick={() => {
                toast.promise(delayAfter(registerAndSync(), 1000), {
                  loading: "Syncing...",
                  success: () => {
                    navigate("/");
                    return "Synced successfully!";
                  },
                  error: "Error syncing",
                });
              }}
            >
              <BouncyButton
                className="flex items-center gap-2 text-xl"
                variant="large"
              >
                <RefreshCcw className="size-24 text-primary" />
              </BouncyButton>
            </button>
            <div className="text-center">
              <h3 className="text-lg font-medium">Login Successful!</h3>
              <p className="text-sm text-muted-foreground">
                Click to sync your data
              </p>
            </div>
          </>
        }
      </div>
    </div>
  );
}
