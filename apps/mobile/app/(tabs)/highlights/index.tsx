import { useState } from "react";
import { Stack } from "expo-router";
import { WebScreen } from "../../../src/WebScreen";

export default function HighlightsScreen() {
  const [query, setQuery] = useState("");
  return (
    <>
      <Stack.Screen
        options={{
          title: "Highlights",
          headerShadowVisible: false,
          headerSearchBarOptions: {
            placeholder: "Search highlights",
            hideWhenScrolling: false,
            onChangeText: ({ nativeEvent }) => setQuery(nativeEvent.text),
            onCancelButtonPress: () => setQuery(""),
          },
        }}
      />
      <WebScreen path="/highlights" search={query} />
    </>
  );
}
