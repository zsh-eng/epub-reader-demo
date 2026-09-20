/** Retain entries by measured byte cost, evicting the least recently read first. */
export class ByteCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private size = 0;
  constructor(readonly maxBytes: number) {}
  get bytes() {
    return this.size;
  }
  get count() {
    return this.entries.size;
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes: number) {
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error("Cache size must be a non-negative number.");
    this.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.size += bytes;
    while (this.size > this.maxBytes) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.delete(first);
    }
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.size -= entry.bytes;
      this.entries.delete(key);
    }
  }
  deleteWhere(predicate: (value: T, key: string) => boolean) {
    for (const [key, entry] of this.entries) if (predicate(entry.value, key)) this.delete(key);
  }
  clear() {
    this.entries.clear();
    this.size = 0;
  }
}
