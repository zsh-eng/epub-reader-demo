import { decode, isBlurhashValid } from "blurhash";
import { useEffect, useRef } from "react";

const PLACEHOLDER_WIDTH = 32;
const PLACEHOLDER_HEIGHT = 48;

/** Decode a synchronized BlurHash into a small canvas scaled by CSS. */
export function BlurHashCanvas({
  blurHash,
  className,
}: {
  blurHash: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isValid = isBlurhashValid(blurHash).result;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isValid) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const imageData = context.createImageData(
      PLACEHOLDER_WIDTH,
      PLACEHOLDER_HEIGHT,
    );
    imageData.data.set(decode(blurHash, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT));
    context.putImageData(imageData, 0, 0);
  }, [blurHash, isValid]);

  if (!isValid) return null;

  return (
    <canvas
      ref={canvasRef}
      width={PLACEHOLDER_WIDTH}
      height={PLACEHOLDER_HEIGHT}
      aria-hidden="true"
      data-blur-hash={blurHash}
      className={className}
    />
  );
}
