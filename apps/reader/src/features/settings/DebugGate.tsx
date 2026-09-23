import { useDebugEnabled } from "@/lib/debug-preference";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Block the diagnostic component itself, including direct URL visits. */
export function DebugGate({ children }: { children: ReactNode }) {
  const debugEnabled = useDebugEnabled();
  if (debugEnabled) return children;

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 md:px-6 md:py-10">
      <h1 className="text-2xl font-bold tracking-tight">Debug mode is off</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enable Debug mode in Settings to use diagnostic tools.
      </p>
      <Link
        to="/settings"
        className="mt-4 inline-block text-sm underline underline-offset-4"
      >
        Open settings
      </Link>
    </div>
  );
}
