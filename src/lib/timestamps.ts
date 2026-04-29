export type TimestampInput = number | string | Date;

/**
 * Normalize persisted/synced timestamp values to epoch milliseconds.
 *
 * Older highlight and note rows may still contain Date objects from IndexedDB
 * structured cloning or ISO strings from the sync JSON boundary. New app code
 * stores numbers, but this keeps those historical rows readable.
 */
export function toTimestampMs(value: TimestampInput): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

export function optionalTimestampMs(
  value: TimestampInput | undefined,
): number | undefined {
  return value === undefined ? undefined : toTimestampMs(value);
}
