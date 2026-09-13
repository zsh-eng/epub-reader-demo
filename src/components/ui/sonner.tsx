import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        style: {
          textAlign: "left",
          padding: "12px 16px",
          minHeight: 48,
        },
        classNames: {
          actionButton: "!rounded-[calc(var(--sidebar-panel-radius)-13px)]",
          cancelButton: "!rounded-[calc(var(--sidebar-panel-radius)-13px)]",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--sidebar-panel-radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
