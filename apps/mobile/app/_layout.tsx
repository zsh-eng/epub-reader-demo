import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider } from "@react-navigation/native";
import { NativeThemeProvider, useNativeTheme } from "../src/NativeTheme";
import { RuntimeProvider } from "../src/RuntimeProvider";

export default function RootLayout() {
  return (
    <NativeThemeProvider>
      <AppLayout />
    </NativeThemeProvider>
  );
}

function AppLayout() {
  const { theme } = useNativeTheme();
  return (
    <ThemeProvider value={theme}>
      <RuntimeProvider>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="reader/[bookId]"
            options={{ headerShown: false, gestureEnabled: false }}
          />
        </Stack>
      </RuntimeProvider>
    </ThemeProvider>
  );
}
