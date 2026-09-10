import { useCallback, useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlatformColor, type ColorValue } from "react-native";
import { WebScreen } from "../../src/WebScreen";
import { useRuntime } from "../../src/RuntimeProvider";

export default function ReaderScreen() {
  const { bookId, state } = useLocalSearchParams<{
    bookId: string;
    state?: string;
  }>();
  const { keepAwake } = useRuntime();
  const [appearance, setAppearance] = useState<{
    background: ColorValue;
    dark: boolean;
  }>({ background: PlatformColor("systemBackground"), dark: false });
  const onAppearance = useCallback(
    (background: string, dark: boolean) => setAppearance({ background, dark }),
    [],
  );
  useEffect(() => {
    if (keepAwake) void activateKeepAwakeAsync("reader");
    return () => {
      void deactivateKeepAwake("reader");
    };
  }, [keepAwake]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: appearance.background }}>
      <StatusBar style={appearance.dark ? "light" : "dark"} />
      <WebScreen
        path={`/reader/${encodeURIComponent(bookId)}`}
        initialState={state}
        onAppearance={onAppearance}
      />
    </SafeAreaView>
  );
}
