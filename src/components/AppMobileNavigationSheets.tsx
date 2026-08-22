import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ContinueReadingCard } from "@/components/ContinueReadingCard";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import type { AppearanceMode } from "@/hooks/use-reader-settings";
import type { RecentlyReadBook } from "@/lib/library-sort";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  BookPlus,
  Clock3,
  Cloud,
  CloudOff,
  Highlighter,
  Library,
  Loader2,
  LogIn,
  LogOut,
  Monitor,
  MonitorSmartphone,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const MotionLink = motion.create(Link);

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
  appearanceMode: AppearanceMode;
  onAppearanceChange: (appearanceMode: AppearanceMode) => void;
  isImporting: boolean;
  onAddBook: () => void;
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

interface SheetUtilityButtonProps {
  label: string;
  accessibleLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
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
  const springPress = useSpringPressAnimation();
  const className = cn(
    "flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left outline-none transition-[background-color,border-color] focus-visible:ring-2 focus-visible:ring-ring/60",
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
      initial={{ opacity: 0, transform: "translateY(16px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{
        duration: 0.2,
        ease: [0.16, 1, 0.3, 1],
        delay,
      }}
    >
      {to ? (
        <MotionLink
          to={to}
          aria-current={isActive ? "page" : undefined}
          className={className}
          onClick={onClick}
          {...springPress}
        >
          {content}
        </MotionLink>
      ) : (
        <motion.button
          type="button"
          className={className}
          onClick={onClick}
          disabled={disabled}
          {...springPress}
        >
          {content}
        </motion.button>
      )}
    </motion.div>
  );
}

function SheetUtilityButton({
  label,
  accessibleLabel,
  onClick,
  disabled = false,
  className,
  children,
}: SheetUtilityButtonProps) {
  const springPress = useSpringPressAnimation();

  return (
    <motion.button
      type="button"
      aria-label={accessibleLabel ?? label}
      title={accessibleLabel ?? label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-muted-foreground outline-none transition-[background-color,color] hover:bg-secondary/55 hover:text-foreground focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
      {...springPress}
    >
      {children}
      <span className="max-w-full truncate text-[10px] font-medium uppercase tracking-[0.12em]">
        {label}
      </span>
    </motion.button>
  );
}

function getNextAppearanceMode(appearanceMode: AppearanceMode): AppearanceMode {
  if (appearanceMode === "light") return "dark";
  if (appearanceMode === "dark") return "system";
  return "light";
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
      initial={{ opacity: 0, transform: "translateY(16px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <ContinueReadingCard
        bookId={recentReading.book.id}
        bookTitle={recentReading.book.title}
        coverUrl={coverUrl}
        activityLabel={activityLabel}
        isActive={isActive}
      />
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
  appearanceMode,
  onAppearanceChange,
  isImporting,
  onAddBook,
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
  const AppearanceIcon =
    appearanceMode === "light"
      ? Sun
      : appearanceMode === "dark"
        ? Moon
        : Monitor;
  const appearanceLabel =
    appearanceMode === "light"
      ? "Light"
      : appearanceMode === "dark"
        ? "Dark"
        : "System";

  useEffect(() => {
    if (!isOpen) setActiveSheet("navigation");
  }, [isOpen]);

  return (
    <>
      <BottomSheet
        open={isOpen && activeSheet === "navigation"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Reader"
        showHeader={false}
        panelClassName="max-w-md"
        bodyClassName="overflow-y-auto"
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
              onClick={onClose}
              delay={0.04}
            />
            <MobileSheetRow
              index="02"
              label="Highlights"
              icon={Highlighter}
              to="/highlights"
              isActive={activePath === "/highlights"}
              onClick={onClose}
              delay={0.08}
            />
            <MobileSheetRow
              index="03"
              label="Sessions"
              icon={Clock3}
              to="/reading-sessions"
              isActive={activePath === "/reading-sessions"}
              onClick={onClose}
              delay={0.12}
            />
          </div>

          <motion.div
            className="mt-3 grid w-full grid-cols-3 overflow-hidden rounded-[1.25rem] border border-border/60 bg-secondary/20"
            initial={{ opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
          >
            <SheetUtilityButton
              label="Theme"
              accessibleLabel={`Switch appearance. Current setting: ${appearanceLabel}`}
              onClick={() =>
                onAppearanceChange(getNextAppearanceMode(appearanceMode))
              }
            >
              <AppearanceIcon className="size-5" aria-hidden="true" />
            </SheetUtilityButton>

            <SheetUtilityButton
              label={isImporting ? "Adding…" : "Add book"}
              accessibleLabel={isImporting ? "Adding book" : "Add book"}
              onClick={onAddBook}
              disabled={isImporting}
              className="border-l border-border/60"
            >
              {isImporting ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                <BookPlus className="size-5" aria-hidden="true" />
              )}
            </SheetUtilityButton>

            {isAuthLoading ? (
              <SheetUtilityButton
                label="Account"
                accessibleLabel="Loading account"
                disabled
                className="border-l border-border/60"
              >
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              </SheetUtilityButton>
            ) : isAuthenticated && user ? (
              <SheetUtilityButton
                label="Account"
                accessibleLabel={`${user.name || "Account"}, ${user.email}`}
                onClick={() => setActiveSheet("account")}
                className="border-l border-border/60"
              >
                <Avatar className="size-7">
                  <AvatarImage
                    src={user.image || undefined}
                    alt={user.name || "User"}
                  />
                  <AvatarFallback className="text-[10px]">
                    {getUserInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </SheetUtilityButton>
            ) : (
              <SheetUtilityButton
                label="Sign in"
                accessibleLabel="Sign in with Google"
                onClick={() => void onSignIn()}
                className="border-l border-border/60"
              >
                <LogIn className="size-5" aria-hidden="true" />
              </SheetUtilityButton>
            )}
          </motion.div>
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
              initial={{ opacity: 0, transform: "translateY(12px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
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
                onClick={onClose}
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
