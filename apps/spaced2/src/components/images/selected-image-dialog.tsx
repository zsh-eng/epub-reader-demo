import BlobImage from "./blob-image";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CachedImage, imagePersistedDb } from "@/lib/images/db";
import { cn } from "@/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";

type SelectedImageDialogProps = {
  image: CachedImage | null;
  onExit: () => void;
};

export default function SelectedImageDialog({
  image,
  onExit,
}: SelectedImageDialogProps) {
  const imageBlob = useLiveQuery(
    () => (image?.url ? imagePersistedDb.imageBlobs.get(image.url) : undefined),
    [image?.url],
  );
  const blob = imageBlob?.url === image?.url ? imageBlob?.content : undefined;

  return (
    <Dialog
      open={!!image}
      onOpenChange={(open) => {
        if (!open) {
          onExit();
        }
      }}
    >
      <DialogContent
        className={cn(
          "p-0 rounded-none w-full animate-in fade-in-0 zoom-in-95 duration-200",
        )}
        hideClose
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <BlobImage
          blob={blob}
          id="image-dialog"
          alt={image?.altText ?? "cached image"}
          className={cn("shadow-sm w-full")}
        />

        <div
          id="hello"
          className="text-white text-center absolute -bottom-8 left-1/2 -translate-x-1/2"
        >
          {image?.altText}
        </div>
      </DialogContent>
    </Dialog>
  );
}
