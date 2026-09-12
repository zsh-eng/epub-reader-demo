import { useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { useFileUrl } from "@/hooks/use-file-url";
import { getBookCoverFileId } from "@/lib/book-file-references";
import type { RecentlyReadBook } from "@/lib/library-sort";
import { postNative } from "./runtime";

/** Reuse the Library query for native navigation. Only a small, locally
 * available cover preview crosses the bridge; EPUB bytes remain in the web app.
 */
export function NativeLibraryState({
  recent,
}: {
  recent: RecentlyReadBook | null;
}) {
  const { url } = useFileUrl(
    recent ? getBookCoverFileId(recent.book) : undefined,
    { localOnly: true },
  );
  useEffect(() => {
    let cancelled = false;
    const report = (cover: string) => {
      if (cancelled) return;
      postNative({
        type: "library-state",
        recent: recent
          ? {
              id: recent.book.id,
              title: recent.book.title,
              activity: `Last read ${formatDistanceToNow(new Date(recent.lastRead), { addSuffix: true })}`,
              cover,
            }
          : null,
      });
    };
    report("");
    if (recent && url) {
      const image = new Image();
      image.src = url;
      void image
        .decode()
        .then(() => {
          if (cancelled) return;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 256;
          const context = canvas.getContext("2d")!;
          const size = Math.min(image.naturalWidth, image.naturalHeight);
          context.drawImage(
            image,
            (image.naturalWidth - size) / 2,
            (image.naturalHeight - size) / 2,
            size,
            size,
            0,
            0,
            256,
            256,
          );
          report(canvas.toDataURL("image/jpeg", 0.85));
        })
        .catch(() => report(""));
    }
    return () => {
      cancelled = true;
    };
  }, [recent, url]);
  return null;
}
