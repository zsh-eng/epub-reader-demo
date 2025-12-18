import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useSessions } from "@/hooks/use-sessions";
import type { DeviceType, SessionInfo } from "@/types/session";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Globe, Monitor, Smartphone, Tablet } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

function getDeviceIcon(deviceType: DeviceType) {
  switch (deviceType) {
    case "mobile":
      return Smartphone;
    case "tablet":
      return Tablet;
    case "desktop":
      return Monitor;
    default:
      return Globe;
  }
}

function formatSessionTime(dateString: string) {
  const date = new Date(dateString);
  return formatDistanceToNow(date, { addSuffix: true });
}

function SessionItem({
  session,
  isLast,
}: {
  session: SessionInfo;
  isLast?: boolean;
}) {
  const DeviceIcon = getDeviceIcon(session.deviceType);
  const browserName = session.browser.name;
  const browserVersion = session.browser.version;
  const osName = session.os.name;
  const osVersion = session.os.version;

  // Construct descriptive strings
  const title = `${browserName} ${browserVersion}`;
  const subtitle = `${osName} ${osVersion}`;

  return (
    <div
      className={`flex items-center gap-4 p-4 ${
        !isLast ? "border-b border-border" : ""
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          session.isCurrent
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        <DeviceIcon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-medium text-foreground truncate text-sm text-left">
              {title}
            </h3>
            <p className="text-xs text-muted-foreground truncate mt-0.5 text-left">
              {subtitle}
            </p>
          </div>
          <span
            className={`text-xs whitespace-nowrap ${
              session.isCurrent
                ? "text-primary font-medium"
                : "text-muted-foreground"
            }`}
          >
            {session.isCurrent
              ? "online"
              : formatSessionTime(session.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-border last:border-0">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export function Sessions() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { data: sessions, isLoading: isSessionsLoading, error } = useSessions();

  // Redirect to home if not authenticated
  if (!isAuthLoading && !isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const currentSession = sessions?.find((s) => s.isCurrent);
  const otherSessions = sessions?.filter((s) => !s.isCurrent) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
        {/* Header */}
        <header className="mb-8 flex flex-col">
          <Link to="/" className="self-start">
            <Button
              variant="ghost"
              size="lg"
              className="rounded-xl mb-4 -ml-1 group gap-1"
            >
              <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              Back to Library
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Sessions
          </h1>
        </header>

        {/* Error State */}
        {error && (
          <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
            <div className="p-6 text-center">
              <p className="text-destructive">
                Failed to load sessions. Please try again.
              </p>
            </div>
          </Card>
        )}

        {/* Loading State */}
        {(isAuthLoading || isSessionsLoading) && (
          <div className="space-y-8">
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                This Device
              </h2>
              <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
                <SessionSkeleton />
              </Card>
            </div>
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                Active Sessions
              </h2>
              <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
                <SessionSkeleton />
                <SessionSkeleton />
              </Card>
            </div>
          </div>
        )}

        {/* Sessions List */}
        {!isAuthLoading && !isSessionsLoading && !error && sessions && (
          <div className="space-y-8">
            {/* Current Session */}
            {currentSession && (
              <section>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                  This Device
                </h2>
                <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
                  <SessionItem session={currentSession} isLast />
                </Card>
              </section>
            )}

            {/* Other Active Sessions */}
            {otherSessions.length > 0 && (
              <section>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                  Active Sessions
                </h2>
                <Card className="overflow-hidden px-2 py-2 bg-background rounded-3xl shadow-none gap-0">
                  {otherSessions.map((session, index) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isLast={index === otherSessions.length - 1}
                    />
                  ))}
                </Card>
              </section>
            )}

            {/* Empty State for other sessions */}
            {otherSessions.length === 0 && currentSession && (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  You are not logged in on any other devices.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
