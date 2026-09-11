import { requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";

interface Props extends ViewProps {
  snapshot: string;
  onCommand(event: { nativeEvent: { message: Record<string, unknown> } }): void;
}

export const NativeReaderControls =
  requireNativeViewManager<Props>("ReaderRuntime");
