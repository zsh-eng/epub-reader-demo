/** Storage implementation owned by one simulated client, including preferences. */
export class LabStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
  restore(values: Record<string, string>) {
    this.values = new Map(Object.entries(values));
  }
}
