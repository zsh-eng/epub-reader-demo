/**
 * Date Utilities
 *
 * Messaging-style time formatting for highlights.
 */

/**
 * Format a date for display in highlight cards using messaging-style rules:
 * - Last 24 hours: show time like "11:24 AM"
 * - 24h to 1 year: show date like "24 Dec"
 * - Over 1 year: show year like "2024"
 */
export function formatHighlightTime(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();

  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Within last 24 hours: show time
  if (diffHours < 24) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  // Within last year: show day and month
  if (diffDays < 365) {
    return d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    });
  }

  // Over a year old: show just year
  return d.getFullYear().toString();
}
