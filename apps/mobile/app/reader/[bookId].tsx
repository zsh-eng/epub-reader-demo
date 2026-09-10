import { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlatformColor } from "react-native";
import { WebScreen } from "../../src/WebScreen";
import { useRuntime } from "../../src/RuntimeProvider";

export default function ReaderScreen() {
  const { bookId, state } = useLocalSearchParams<{
    bookId: string;
    state?: string;
  }>();
  const { keepAwake } = useRuntime();
  useEffect(() => {
    if (keepAwake) void activateKeepAwakeAsync("reader");
    return () => {
      void deactivateKeepAwake("reader");
    };
  }, [keepAwake]);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: PlatformColor("systemBackground") }}
    >
      <WebScreen
        path={`/reader/${encodeURIComponent(bookId)}`}
        initialState={state}
      />
    </SafeAreaView>
  );
}
