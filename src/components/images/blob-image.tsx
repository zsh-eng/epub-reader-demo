import { type ImgHTMLAttributes } from "react";
import useObjectUrl from "@/lib/images/use-object-url";

export default function BlobImage({
  blob,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { blob?: Blob | null }) {
  const url = useObjectUrl(blob);
  return <img {...props} src={url} />;
}
