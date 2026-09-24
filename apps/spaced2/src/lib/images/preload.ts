import { getCachedImage, revokeImage } from "./db";

// Keep shared images once, limit concurrent work, and release departed entries.
export class ReviewImagePreloader {
  private entries = new Map<
    string,
    { active: boolean; loaded: boolean; image?: HTMLImageElement }
  >();
  private running = 0;
  constructor(
    private acquire = getCachedImage,
    private release = revokeImage,
  ) {}
  update(urls: readonly string[]) {
    const wanted = new Set(urls);
    for (const [url, entry] of this.entries)
      if (!wanted.has(url)) {
        entry.active = false;
        if (entry.loaded) this.release(url);
        this.entries.delete(url);
      }
    for (const url of wanted)
      if (!this.entries.has(url))
        this.entries.set(url, { active: true, loaded: false });
    this.pump();
  }
  private pump() {
    for (const [url, entry] of this.entries) {
      if (this.running >= 4) break;
      if (entry.loaded || entry.image) continue;
      const image = document.createElement("img");
      entry.image = image;
      this.running++;
      void this.acquire(url, "")
        .then(async (objectURL) => {
          if (!entry.active) {
            this.release(url);
            return;
          }
          entry.loaded = true;
          image.src = objectURL;
          await image.decode?.().catch(() => {});
        })
        .catch(() => {
          // Display can retry a failed preload. Do not spin on network errors.
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
  dispose() {
    this.update([]);
  }
}
