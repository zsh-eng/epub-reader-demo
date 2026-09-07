import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import useObjectUrl from "@/lib/images/use-object-url";
import { Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ImageUploadDialogProps {
  image: string | File | null;
  onSubmit: (altText?: string) => void | Promise<void>;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function ImageUploadDialog({
  image,
  onSubmit,
  loading = false,
  open,
  onOpenChange,
}: ImageUploadDialogProps) {
  const [altText, setAltText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const objectUrl = useObjectUrl(open && image instanceof Blob ? image : null);
  useEffect(() => {
    setAltText("");
    setError(undefined);
  }, [image]);
  if (image === null) return null;
  const imageUrl = typeof image === "string" ? image : objectUrl;
  const busy = loading || pending;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!lock.current && !loading) onOpenChange?.(value);
      }}
    >
      <DialogContent className="sm:max-w-md px-0 py-3 gap-2">
        <DialogHeader>
          <DialogTitle className="text-center text-base">
            Image Upload
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current || loading) return;
            lock.current = true;
            setPending(true);
            setError(undefined);
            try {
              await onSubmit(altText);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not upload or copy the image. Try again.",
              );
            } finally {
              lock.current = false;
              setPending(false);
            }
          }}
        >
          <fieldset disabled={busy} className="flex flex-col gap-2">
            <div className="flex items-center justify-center border rounded-lg p-2">
              <img
                src={imageUrl}
                alt={altText}
                className="max-h-[240px] object-contain"
              />
            </div>
            <div className="flex justify-between items-center pl-1 pr-5">
              <Input
                className="border-none shadow-none focus-visible:ring-0 flex-1"
                id="alt-text"
                aria-label="Image description"
                value={altText}
                onChange={(event) => setAltText(event.target.value)}
                placeholder="Describe this image..."
              />
              <button
                type="submit"
                aria-label="Upload image and copy link"
                disabled={busy}
              >
                {busy ? (
                  <Loader2
                    className="w-6 h-6 text-primary animate-spin"
                    strokeWidth={2}
                  />
                ) : (
                  <Upload className="w-6 h-6 text-primary" strokeWidth={2} />
                )}
              </button>
            </div>
            {error && (
              <p role="alert" className="px-4 text-sm text-destructive">
                {error}
              </p>
            )}
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
