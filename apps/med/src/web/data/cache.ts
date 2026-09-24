/** Byte-bounded LRU. The active view remains owned by the controller. */
export class ByteLru<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private total = 0;

  constructor(
    readonly maxBytes: number,
    readonly maxEntries = 24,
    private readonly onEvict?: (key: string, value: T) => void,
  ) {}

  get bytes(): number {
    return this.total;
  }
  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    this.delete(key);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.total += bytes;
    while (this.total > this.maxBytes || this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.delete(first);
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.total -= entry.bytes;
    this.entries.delete(key);
    if (entry) this.onEvict?.(key, entry.value);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }
}

/** Conservative serialized-data budget; includes UTF-16 string storage and object allowance. */
export function estimateRetainedBytes(value: unknown): number {
  return JSON.stringify(value).length * 4;
}
