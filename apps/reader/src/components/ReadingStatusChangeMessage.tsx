import { READING_STATUS_LABELS } from "./BookStatusSheet";
import type { ReadingStatus } from "@/types/reading-state";

/** Status feedback omits book titles so long titles cannot crowd the toast. */
export function ReadingStatusChangeMessage({
  previousStatus,
  status,
}: {
  previousStatus: ReadingStatus | null;
  status: ReadingStatus;
}) {
  if (!previousStatus)
    return (
      <>
        Changed status to <strong>{READING_STATUS_LABELS[status]}</strong>.
      </>
    );
  return (
    <>
      Changed <strong>{READING_STATUS_LABELS[previousStatus]}</strong> to{" "}
      <strong>{READING_STATUS_LABELS[status]}</strong>.
    </>
  );
}
