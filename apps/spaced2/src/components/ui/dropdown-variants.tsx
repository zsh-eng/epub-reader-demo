import { cva } from "class-variance-authority";

export const dropdownMenuItemVariants = cva(
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors focus:bg-accent data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "text-muted-foreground",
        telegram:
          "px-3 py-2 hover:bg-muted-foreground/10 focus:bg-muted-foreground/10 active:bg-muted-foreground/10 active:scale-97 rounded-md transition-all flex items-center gap-5 sm:gap-2 font-medium group",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
