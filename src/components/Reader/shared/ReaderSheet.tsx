import {
  BottomSheet,
  type BottomSheetProps,
} from "@/components/ui/bottom-sheet";

/** Reader-named entry point for the shared application bottom sheet. */
export function ReaderSheet(props: BottomSheetProps) {
  return <BottomSheet {...props} />;
}
