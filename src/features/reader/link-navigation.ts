import { isExternalHref, splitHrefFragment } from "@/lib/epub-resource-utils";

export interface ResolvedPaginatedLinkTarget {
  chapterIndex: number;
  targetId?: string;
}

export function resolvePaginatedLinkTarget(
  href: string,
  chapterIndexByHrefPath: ReadonlyMap<string, number>,
): ResolvedPaginatedLinkTarget | null {
  if (!href || isExternalHref(href)) return null;

  const { path, fragment } = splitHrefFragment(href);
  const chapterIndex = chapterIndexByHrefPath.get(path);
  if (chapterIndex === undefined) return null;

  return fragment ? { chapterIndex, targetId: fragment } : { chapterIndex };
}
