import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  message: ReactNode;
  variant?: "default" | "destructive";
  duration?: number;
  action?: { label: string; onClick: () => void };
}

/** App notifications use one message, with optional actions. */
function toast({ message, variant, duration = 4000, action }: ToastOptions) {
  const notify =
    variant === "destructive" ? sonnerToast.error : sonnerToast.success;
  return notify(message, { duration, action });
}

export function useToast() {
  return { toast };
}
