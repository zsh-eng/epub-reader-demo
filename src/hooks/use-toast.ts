import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export function useToast() {
  const toast = ({
    title,
    description,
    variant,
    duration,
    action,
  }: ToastOptions) => {
    const message = title || "";
    const descriptionText = description || "";

    if (variant === "destructive") {
      sonnerToast.error(message, {
        description: descriptionText,
        duration: duration || 4000,
        action,
      });
    } else {
      sonnerToast.success(message, {
        description: descriptionText,
        duration: duration || 4000,
        action,
      });
    }
  };

  return { toast };
}
