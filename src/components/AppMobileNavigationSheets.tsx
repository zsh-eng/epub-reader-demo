import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { RecentlyReadBook } from "@/lib/library-sort";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  CloudOff,
  Highlighter,
  Library,
  Loader2,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

type MobileNavigationSheet = "navigation" | "account";

interface AppNavigationUser {
  name?: string | null;
  email: string;
  image?: string | null;
}

interface AppMobileNavigationSheetsProps {
  isOpen: boolean;
  onClose: () => void;
  activePath: string;
  recentReading: RecentlyReadBook | null;
  recentBookCoverUrl: string | undefined;
  isDarkTheme: boolean;
  onThemeToggle: () => void;
  isOnline: boolean;
  isSyncing: boolean;
  onSync: () => Promise<void>;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  user: AppNavigationUser | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

interface MobileSheetRowProps {
  index: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  delay: number;
}

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function MobileSheetRow({
  index,
  label,
  description,
  icon: Icon,
  trailing,
  to,
  onClick,
  isActive = false,
  disabled = false,
  destructive = false,
  delay,
}: MobileSheetRowProps) {
  const className = cn(
    "flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left outline-none transition-[background-color,border-color,transform] focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.985] motion-reduce:active:scale-100",
    isActive && "border-border bg-secondary/65",
    disabled ? "cursor-not-allowed opacity-55" : "hover:bg-secondary/55",
  );
  const content = (
    <>
      <span className="min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {index}
        </span>
        <span
          className={cn(
            "mt-1 block truncate text-sm font-medium",
            destructive ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>

      {trailing ??
        (Icon ? (
          <Icon
            className={cn(
              "size-4 shrink-0",
              destructive ? "text-destructive" : "text-muted-foreground",
            )}
          />
        ) : null)}
    </>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        ease: [0.16, 1, 0.3, 1],
        delay,
      }}
    >
      {to ? (
        <Link
          to={to}
          aria-current={isActive ? "page" : undefined}
          className={className}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          className={className}
          onClick={onClick}
          disabled={disabled}
        >
          {content}
        </button>
      )}
    </motion.div>
  );
}

interface ContinueReadingOrbProps {
  recentReading: RecentlyReadBook;
  coverUrl: string | undefined;
  isActive: boolean;
}

/**
 * A circular continuation target inspired by Libby's resume surface. The
 * cover remains the focus while the surrounding card uses the same command
 * typography and restrained press response as the reader tools menu.
 */
function ContinueReadingOrb({
  recentReading,
  coverUrl,
  isActive,
}: ContinueReadingOrbProps) {
  const activityLabel = isActive
    ? "Reading now"
    : `Last read ${formatDistanceToNow(new Date(recentReading.lastRead), {
        addSuffix: true,
      })}`;

  return (
    <motion.div
      className="px-4 pt-3"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        to={`/reader/${recentReading.book.id}`}
        aria-label={`Continue reading ${recentReading.book.title}`}
        aria-current={isActive ? "page" : undefined}
        className="group block rounded-[1.5rem] border border-border/60 bg-secondary/35 px-4 pb-4 pt-3 text-center outline-none transition-[background-color,border-color,transform] hover:bg-secondary/55 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.985] motion-reduce:active:scale-100"
      >
        <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <span>00</span>
          <span>Continue reading</span>
          <BookOpenText className="size-4" aria-hidden="true" />
        </span>

        <span className="my-3 flex justify-center">
          <span className="relative flex size-24 items-center justify-center overflow-hidden rounded-full border-[5px] border-background bg-secondary shadow-sm ring-1 ring-border/70 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.025] motion-reduce:transition-none">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                aria-hidden="true"
                className="size-full object-cover"
              />
            ) : (
              <BookOpenText
                className="size-7 text-muted-foreground/60"
                aria-hidden="true"
              />
            )}
          </span>
        </span>

        <span className="block truncate font-serif text-base font-medium tracking-[-0.01em] text-foreground">
          {recentReading.book.title}
        </span>
        <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {activityLabel}
        </span>
      </Link>
    </motion.div>
  );
}

function SheetBackHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label="Back to navigation"
        className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Account
      </p>

      <div className="size-8" aria-hidden="true" />
    </div>
  );
}

export function AppMobileNavigationSheets({
  isOpen,
  onClose,
  activePath,
  recentReading,
  recentBookCoverUrl,
  isDarkTheme,
  onThemeToggle,
  isOnline,
  isSyncing,
  onSync,
  isAuthenticated,
  isAuthLoading,
  user,
  onSignIn,
  onSignOut,
}: AppMobileNavigationSheetsProps) {
  const [activeSheet, setActiveSheet] =
    useState<MobileNavigationSheet>("navigation");

  useEffect(() => {
    if (!isOpen) setActiveSheet("navigation");
  }, [isOpen]);

  const accountTrailing = user ? (
    <span className="flex shrink-0 items-center gap-2">
      <Avatar className="size-7">
        <AvatarImage src={user.image || undefined} alt={user.name || "User"} />
        <AvatarFallback className="text-[10px]">
          {getUserInitials(user.name)}
        </AvatarFallback>
      </Avatar>
      <ChevronRight className="size-4 text-muted-foreground" />
    </span>
  ) : null;

  return (
    <>
      <BottomSheet
        open={isOpen && activeSheet === "navigation"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Reader"
        panelClassName="max-w-md"
        bodyClassName="overflow-y-auto"
        disableBodyDrag
      >
        {recentReading && (
          <ContinueReadingOrb
            recentReading={recentReading}
            coverUrl={recentBookCoverUrl}
            isActive={activePath === `/reader/${recentReading.book.id}`}
          />
        )}

        <div
          className="px-4 py-3"
          style={{
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
          }}
        >
          <div className="flex flex-col gap-2">
            <MobileSheetRow
              index="01"
              label="Library"
              icon={Library}
              to="/"
              isActive={activePath === "/"}
              delay={0.04}
            />
            <MobileSheetRow
              index="02"
              label="Highlights"
              icon={Highlighter}
              to="/highlights"
              isActive={activePath === "/highlights"}
              delay={0.08}
            />
            <MobileSheetRow
              index="03"
              label="Sessions"
              icon={Clock3}
              to="/reading-sessions"
              isActive={activePath === "/reading-sessions"}
              delay={0.12}
            />
            <MobileSheetRow
              index="04"
              label={
                isDarkTheme ? "Use light appearance" : "Use dark appearance"
              }
              icon={isDarkTheme ? Sun : Moon}
              onClick={onThemeToggle}
              delay={0.16}
            />

            {isAuthLoading ? (
              <MobileSheetRow
                index="05"
                label="Loading account…"
                icon={Loader2}
                disabled
                delay={0.24}
              />
            ) : isAuthenticated && user ? (
              <MobileSheetRow
                index="05"
                label={user.name || "Account"}
                description={user.email}
                trailing={accountTrailing}
                onClick={() => setActiveSheet("account")}
                delay={0.2}
              />
            ) : (
              <MobileSheetRow
                index="05"
                label="Sign in with Google"
                icon={LogIn}
                onClick={() => void onSignIn()}
                delay={0.2}
              />
            )}
          </div>
        </div>
      </BottomSheet>

      {user && (
        <BottomSheet
          open={isOpen && activeSheet === "account"}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          title="Account"
          panelClassName="max-w-md"
          header={
            <SheetBackHeader onBack={() => setActiveSheet("navigation")} />
          }
        >
          <div
            className="px-4 pb-4 pt-3"
            style={{
              paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
            }}
          >
            <motion.div
              className="mb-3 flex items-center gap-3 rounded-[1.25rem] border border-border/60 bg-secondary/20 px-4 py-3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <Avatar className="size-11">
                <AvatarImage
                  src={user.image || undefined}
                  alt={user.name || "User"}
                />
                <AvatarFallback className="text-xs">
                  {getUserInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {user.name || "Account"}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </span>
            </motion.div>

            <div className="flex flex-col gap-2">
              <MobileSheetRow
                index="01"
                label="Devices"
                icon={MonitorSmartphone}
                to="/devices"
                isActive={activePath === "/devices"}
                delay={0.04}
              />
              <MobileSheetRow
                index="02"
                label={
                  isSyncing ? "Syncing…" : isOnline ? "Sync now" : "Offline"
                }
                icon={isSyncing ? Loader2 : isOnline ? Cloud : CloudOff}
                trailing={
                  isSyncing ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : undefined
                }
                onClick={() => void onSync()}
                disabled={isSyncing || !isOnline}
                delay={0.08}
              />
              <MobileSheetRow
                index="03"
                label="Sign out"
                icon={LogOut}
                onClick={() => void onSignOut()}
                destructive
                delay={0.12}
              />
            </div>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
