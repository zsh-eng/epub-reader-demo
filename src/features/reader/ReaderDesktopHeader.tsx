import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Bookmark, PanelRight } from "lucide-react";
import { motion } from "motion/react";
import { DESKTOP_CHROME_FADE_TRANSITION } from "./chrome";
import type { ReaderHeaderProps } from "./ReaderHeader";

const CHROME_BUTTON_CLASS_NAME =
  "size-9 rounded-xl text-muted-foreground transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary/70 hover:text-foreground active:scale-95 motion-reduce:active:scale-100 aria-pressed:bg-secondary/70 aria-pressed:text-foreground";

type ReaderDesktopHeaderProps = Omit<
  ReaderHeaderProps,
  "isMobile" | "onBackToLibrary"
>;

/** Desktop controls fade in place. Mobile keeps its sliding header and ribbon. */
export function ReaderDesktopHeader({
  chromeVisible,
  accessory,
  chromeSurfaceProps,
  bookTitle,
  isBookmarked,
  onToggleBookmark,
  isMenuOpen,
  onOpenMenu,
}: ReaderDesktopHeaderProps) {
  return (
    <>
      <motion.header
        data-reader-header="desktop"
        className="absolute inset-x-0 top-0 z-20 bg-background/88 backdrop-blur-xl"
        initial={false}
        animate={{ opacity: chromeVisible ? 1 : 0 }}
        transition={DESKTOP_CHROME_FADE_TRANSITION}
        inert={!chromeVisible}
        aria-hidden={!chromeVisible}
        {...chromeSurfaceProps}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          pointerEvents: chromeVisible ? "auto" : "none",
        }}
      >
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-4">
          <div className="flex items-center">
            <SidebarTrigger className={CHROME_BUTTON_CLASS_NAME} />
          </div>
          <p className="max-w-[min(64vw,36rem)] truncate px-4 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {bookTitle}
          </p>
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleBookmark}
              aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
              aria-pressed={isBookmarked}
              className={CHROME_BUTTON_CLASS_NAME}
            >
              <Bookmark
                className="size-[1.15rem]"
                fill={isBookmarked ? "currentColor" : "none"}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMenu}
              aria-label="Open reader tools"
              aria-expanded={isMenuOpen}
              aria-pressed={isMenuOpen}
              className={CHROME_BUTTON_CLASS_NAME}
            >
              <PanelRight className="size-[1.15rem]" />
            </Button>
          </div>
        </div>
      </motion.header>
      {/* Status and handoff actions stay available below the controls, without
        moving when the chrome appears or disappears. */}
      {accessory && (
        <div
          data-reader-header-accessory=""
          className="absolute right-4 z-20 w-[min(34rem,calc(100%-4rem))]"
          style={{ top: "calc(env(safe-area-inset-top) + 4rem)" }}
          {...(chromeVisible ? chromeSurfaceProps : undefined)}
        >
          {accessory}
        </div>
      )}
    </>
  );
}
