import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { PlatformColor, StyleSheet, type ColorValue } from "react-native";
import { WebScreen, type WebScreenHandle } from "../../src/WebScreen";
import { NativeReaderControls } from "../../src/NativeReaderControls";
import { useRuntime } from "../../src/RuntimeProvider";

export default function ReaderScreen() {
  const { bookId, state } = useLocalSearchParams<{
    bookId: string;
    state?: string;
  }>();
  const { keepAwake } = useRuntime();
  const insets = useSafeAreaInsets();
  const web = useRef<WebScreenHandle>(null);
  const [snapshot, setSnapshot] = useState("");
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
        ref={web}
        path={`/reader/${encodeURIComponent(bookId)}`}
        initialState={state}
        onAppearance={onAppearance}
        onReaderState={setSnapshot}
      />
      <NativeReaderControls
        style={[
          StyleSheet.absoluteFill,
          { top: insets.top, bottom: insets.bottom },
        ]}
        snapshot={snapshot}
        onCommand={({ nativeEvent }) => web.current?.send(nativeEvent.message)}
      />
    </SafeAreaView>
  );
}
