import type { PaginationEvent } from "./engine-types";

export function normalizePaginationRevision(
  revision: number | undefined,
  fallback = 0,
): number {
  if (typeof revision !== "number" || !Number.isFinite(revision)) {
    return fallback;
  }

  return Math.max(0, Math.floor(revision));
}

export function shouldAcceptPaginationEvent(
  event: PaginationEvent,
  latestPostedLayoutRevision: number,
): boolean {
  if (event.revision === undefined) {
    return true;
  }

  const eventRevision = normalizePaginationRevision(event.revision, -1);
  return eventRevision >= latestPostedLayoutRevision;
}
