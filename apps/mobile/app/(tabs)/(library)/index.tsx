import { useState } from "react";
import { Button } from "react-native";
import { Stack } from "expo-router";
import { WebScreen } from "../../../src/WebScreen";
import { useRuntime } from "../../../src/RuntimeProvider";

export default function LibraryScreen() {
  const [query, setQuery] = useState("");
  const { pickBooks } = useRuntime();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Library",
          headerTransparent: false,
          headerShadowVisible: false,
          headerRight: () => (
            <Button title="Add books" onPress={() => void pickBooks()} />
          ),
          headerSearchBarOptions: {
            placeholder: "Search books or authors",
            hideWhenScrolling: false,
            obscureBackground: false,
            onChangeText: ({ nativeEvent }) => setQuery(nativeEvent.text),
            onCancelButtonPress: () => setQuery(""),
          },
        }}
      />
      <WebScreen path="/" search={query} importsEnabled />
    </>
  );
}
