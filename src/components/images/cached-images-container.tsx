import { cacheImagesInContainer } from "@/lib/images/cache-container";
import { useEffect, useRef } from "react";

type CachedImagesContainerProps = {
  renderItem: (ref: React.RefObject<HTMLDivElement>) => React.ReactNode;
};

export default function CachedImagesContainer({
  renderItem,
}: CachedImagesContainerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) return cacheImagesInContainer(ref.current);
  }, []);
  return <>{renderItem(ref)}</>;
}
