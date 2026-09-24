import BouncyButton from "@/components/bouncy-button";
import { Progress } from "@/components/ui/progress";
import { downloadImageLocally } from "@/lib/images/db";
import { searchForLinks } from "@/lib/images/download-all";
import { PromiseRateLimiterQueue } from "@/lib/images/promise-limiter";
import { CheckCircle, CircleX, DownloadIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const BATCH_SIZE = 5;

export default function DownloadAllImages({
  download = downloadImageLocally,
  findLinks = searchForLinks,
}: {
  download?: typeof downloadImageLocally;
  findLinks?: typeof searchForLinks;
} = {}) {
  const [downloadState, setDownloadState] = useState<
    "idle" | "searching-links" | "downloading" | "finished" | "cancelled"
  >("idle");

  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [totalImages, setTotalImages] = useState<number>(0);
  const [totalDownloaded, setTotalDownloaded] = useState<number>(0);

  const cancelledRef = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [failedImages, setFailedImages] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelledRef.current = true;
    };
  }, []);

  const handleDownload = async () => {
    if (busy.current) return;
    busy.current = true;
    cancelledRef.current = false;
    setDownloadProgress(0);
    setTotalDownloaded(0);
    setFailedImages(0);
    setDownloadState("searching-links");
    const links = findLinks();

    setDownloadState("downloading");
    const linkCount = links.size;
    setTotalImages(linkCount);

    const entries = Array.from(links.entries());
    const limiter = new PromiseRateLimiterQueue(BATCH_SIZE);

    const tasks: Promise<void>[] = [];
    for (let i = 0; i < linkCount; i += 1) {
      const [url, altText] = entries[i];
      const promise = limiter.add(async () => {
        if (cancelledRef.current) {
          return;
        }

        try {
          const { newlyDownloaded } = await download(url, altText);
          if (mounted.current && newlyDownloaded)
            setTotalDownloaded((total) => total + 1);
        } catch (error) {
          console.error(error);
          if (mounted.current) setFailedImages((total) => total + 1);
        } finally {
          if (mounted.current) setDownloadProgress((progress) => progress + 1);
        }
      });

      tasks.push(promise);
    }

    await Promise.allSettled(tasks);
    busy.current = false;
    if (mounted.current)
      setDownloadState(cancelledRef.current ? "cancelled" : "finished");
  };

  return (
    <div className="bg-background dark:bg-muted/50 rounded-xl px-2 py-2 sm:w-full mb-6 flex justify-between items-center mt-4 h-14">
      {downloadState === "idle" && (
        <>
          <div className="text-sm ml-2">Make all images available offline</div>
          <BouncyButton
            asButton
            className="flex justify-center items-center gap-2 bg-primary p-2 rounded-md text-background font-semibold px-4 dark:text-foreground"
            onClick={handleDownload}
          >
            <DownloadIcon className="w-4 h-4" strokeWidth={2.5} />
            <span className="text-sm">Start</span>
          </BouncyButton>
        </>
      )}

      {downloadState === "searching-links" && (
        <>
          <div className="text-sm ml-2 animate-fade-in">
            Searching for links...
          </div>
          <Loader2 className="w-5 h-5 text-primary animate-spin mr-4" />
        </>
      )}

      {downloadState === "downloading" && (
        <>
          <div className="text-sm ml-2 w-full mr-6 animate-fade-in">
            Downloading ({downloadProgress} / {totalImages})...
            <Progress
              key={"progress"}
              className="mt-1"
              value={(downloadProgress / (totalImages || 1)) * 100}
            />
          </div>
          <button
            type="button"
            aria-label="Cancel image downloads"
            onClick={() => {
              cancelledRef.current = true;
              setDownloadState("cancelled");
            }}
          >
            <CircleX className="w-5 h-5 text-muted-foreground mr-2" />
          </button>
        </>
      )}

      {downloadState === "finished" && (
        <>
          <div className="text-sm ml-2 animate-fade-in">
            Downloaded {totalDownloaded} new images
            {failedImages > 0 ? `; ${failedImages} failed` : ""}
          </div>
          <CheckCircle className="w-5 h-5 text-primary mr-4 cursor-pointer" />
        </>
      )}

      {downloadState === "cancelled" && (
        <>
          <div className="text-sm ml-2 w-full mr-12">
            Download cancelled ({downloadProgress} / {totalImages})
            <Progress
              key={"progress"}
              className="mt-1"
              progressColour="bg-muted-foreground/50"
              value={(downloadProgress / (totalImages || 1)) * 100}
            />
          </div>
        </>
      )}
    </div>
  );
}
