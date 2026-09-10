import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Button,
  Linking,
  PlatformColor,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { useRuntime } from "./RuntimeProvider";

interface WebScreenProps {
  path: string;
  search?: string;
  initialState?: string;
  importsEnabled?: boolean;
}

/** A WebView keeps the existing Reader and its database together. Native
 * navigation owns screen transitions; this bridge only carries small commands.
 */
export function WebScreen({
  path,
  search = "",
  initialState = "null",
  importsEnabled = false,
}: WebScreenProps) {
  const { origin, imports, pickBooks, finishImport } = useRuntime();
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [lastImport, setLastImport] = useState<{
    bookId: string;
    title: string;
    duplicate: boolean;
  }>();
  const inFlight = useRef("");
  const focused = useIsFocused();
  const pending = importsEnabled ? imports[0] : undefined;
  const send = useCallback((message: Record<string, unknown>) => {
    const json = JSON.stringify({ version: 1, ...message });
    web.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('reader-native', {data: ${json}})); true;`,
    );
  }, []);

  useEffect(() => {
    if (ready) send({ type: "search", query: search });
  }, [ready, search, send]);
  useEffect(() => {
    if (!ready) return;
    send({
      type: "lifecycle",
      active: focused && AppState.currentState === "active",
    });
    const subscription = AppState.addEventListener("change", (state) =>
      send({ type: "lifecycle", active: focused && state === "active" }),
    );
    return () => {
      subscription.remove();
      send({ type: "lifecycle", active: false });
    };
  }, [focused, ready, send]);

  useEffect(() => {
    if (!ready || !pending || inFlight.current === pending.id) return;
    inFlight.current = pending.id;
    setLastImport(undefined);
    send({ type: "import", ...pending });
  }, [pending, ready, send]);

  const openReader = useCallback((bookId: string, state = "null") => {
    router.push({ pathname: "/reader/[bookId]", params: { bookId, state } });
  }, []);

  const receive = (event: WebViewMessageEvent) => {
    if (!event.nativeEvent.url.startsWith(`${origin}/`)) return;
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.version !== 1) return;
    switch (message.type) {
      case "ready":
        setError("");
        setReady(true);
        break;
      case "pick-books":
        void pickBooks();
        break;
      case "back":
        if (router.canGoBack()) router.back();
        break;
      case "navigate": {
        if (typeof message.path !== "string") break;
        const url = new URL(message.path, origin);
        if (url.origin !== origin) break;
        if (url.pathname.startsWith("/reader/")) {
          openReader(
            decodeURIComponent(url.pathname.slice(8)),
            JSON.stringify(message.state ?? null),
          );
        } else if (path.startsWith("/reader/") && url.pathname === "/") {
          if (router.canGoBack()) router.back();
          else router.replace("/");
        } else if (url.pathname === "/") router.navigate("/");
        else if (url.pathname === "/highlights") router.navigate("/highlights");
        else if (url.pathname === "/reading-sessions")
          router.navigate("/activity");
        else if (url.pathname === "/settings") router.navigate("/settings");
        break;
      }
      case "imported":
      case "import-error": {
        if (!pending || message.id !== pending.id) break;
        void finishImport(message.id)
          .then(() => {
            inFlight.current = "";
          })
          .catch(() =>
            Alert.alert("Could not finish import", "Reopen Reader to retry."),
          );
        if (message.type === "import-error")
          Alert.alert("Could not import book", String(message.error));
        else if (
          typeof message.bookId === "string" &&
          typeof message.title === "string"
        )
          setLastImport({
            bookId: message.bookId,
            title: message.title,
            duplicate: message.duplicate === true,
          });
        break;
      }
    }
  };

  const reload = () => {
    setReady(false);
    setError("");
    inFlight.current = "";
    web.current?.reload();
  };

  return (
    <View style={styles.container}>
      {importsEnabled && (pending || lastImport) && (
        <View style={styles.importRow}>
          {pending ? (
            <>
              <ActivityIndicator />
              <Text style={styles.importText}>Importing {pending.name}…</Text>
            </>
          ) : (
            <>
              <Text numberOfLines={2} style={styles.importText}>
                {lastImport!.duplicate
                  ? "Already in your library"
                  : "Added to your library"}
                : {lastImport!.title}
              </Text>
              <Button
                title="Open"
                onPress={() => openReader(lastImport!.bookId)}
              />
            </>
          )}
        </View>
      )}
      <WebView
        ref={web}
        source={{ uri: `${origin}${path}` }}
        style={styles.web}
        webviewDebuggingEnabled={__DEV__}
        originWhitelist={[origin]}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled={false}
        incognito={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        bounces={!path.startsWith("/reader/")}
        injectedJavaScriptBeforeContentLoaded={`window.__readerInitialState = ${JSON.stringify(JSON.parse(initialState))}; true;`}
        onMessage={receive}
        onShouldStartLoadWithRequest={({ url }) => {
          if (url.startsWith(`${origin}/`) || url === "about:blank")
            return true;
          if (/^https?:\/\//.test(url)) void Linking.openURL(url);
          return false;
        }}
        onError={({ nativeEvent }) => setError(nativeEvent.description)}
        onHttpError={({ nativeEvent }) => {
          if (nativeEvent.url === `${origin}${path}`)
            setError(`Could not open this screen (${nativeEvent.statusCode}).`);
        }}
        onContentProcessDidTerminate={reload}
      />
      {(!ready || error) && (
        <View style={styles.cover}>
          {error ? (
            <>
              <Text style={styles.message}>{error}</Text>
              <Button title="Try again" onPress={reload} />
            </>
          ) : (
            <>
              <ActivityIndicator />
              <Text style={styles.message}>Opening…</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PlatformColor("systemBackground") },
  web: { flex: 1, backgroundColor: PlatformColor("systemBackground") },
  cover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: PlatformColor("systemBackground"),
  },
  message: {
    color: PlatformColor("secondaryLabel"),
    fontSize: 16,
    textAlign: "center",
  },
  importRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    backgroundColor: PlatformColor("secondarySystemBackground"),
  },
  importText: { flex: 1, fontSize: 14, color: PlatformColor("label") },
});
