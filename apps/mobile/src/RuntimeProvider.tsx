import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import * as DocumentPicker from "expo-document-picker";
import ReaderRuntime, { type StagedImport } from "../modules/reader-runtime";

interface RuntimeContextValue {
  origin: string;
  imports: StagedImport[];
  pickBooks(): Promise<void>;
  finishImport(id: string): Promise<void>;
  keepAwake: boolean;
  setKeepAwake(value: boolean): void;
}
const RuntimeContext = createContext<RuntimeContextValue | null>(null);

/** Starts one local runtime and owns durable pending imports. Staged files stay
 * on disk until the web importer acknowledges a completed transaction.
 */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  const [imports, setImports] = useState<StagedImport[]>([]);
  const picking = useRef(false);
  const [keepAwake, updateKeepAwake] = useState(() =>
    ReaderRuntime.getKeepAwake(),
  );

  const start = useCallback(async () => {
    setError("");
    try {
      const url = await ReaderRuntime.start();
      setOrigin(url);
      const pending = await ReaderRuntime.pendingImports();
      setImports((current) => [
        ...new Map(
          [...pending, ...current].map((file) => [file.id, file]),
        ).values(),
      ]);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not start Reader.",
      );
    }
  }, []);
  useEffect(() => {
    void start();
  }, [start]);

  const stage = useCallback(async (uri: string, name: string) => {
    const file = await ReaderRuntime.stageImport(uri, name);
    setImports((current) => [...current, file]);
  }, []);

  useEffect(() => {
    const openFile = (url: string) => {
      if (!url.startsWith("file://")) return;
      const name = decodeURIComponent(url.split("/").pop() ?? "Book.epub");
      void stage(url, name).catch((failure) =>
        Alert.alert("Could not open book", String(failure)),
      );
    };
    void Linking.getInitialURL().then((url) => {
      if (url) openFile(url);
    });
    const subscription = Linking.addEventListener("url", ({ url }) =>
      openFile(url),
    );
    return () => subscription.remove();
  }, [stage]);

  // A suspended process keeps its listener. Resume does not create a new origin
  // or erase data; the native HTTP connection is retried by the WebView.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && !origin) void start();
    });
    return () => subscription.remove();
  }, [origin, start]);

  const pickBooks = useCallback(async () => {
    if (picking.current) return;
    picking.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/epub+zip", "application/octet-stream"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      for (const file of result.assets) {
        if (!file.name.toLowerCase().endsWith(".epub")) {
          Alert.alert("EPUB files only", `${file.name} is not an EPUB book.`);
          continue;
        }
        await stage(file.uri, file.name);
      }
    } catch (failure) {
      Alert.alert(
        "Could not import books",
        failure instanceof Error ? failure.message : String(failure),
      );
    } finally {
      picking.current = false;
    }
  }, [stage]);

  const finishImport = useCallback(async (id: string) => {
    await ReaderRuntime.finishImport(id);
    setImports((current) => current.filter((file) => file.id !== id));
  }, []);
  const setKeepAwake = useCallback((value: boolean) => {
    try {
      ReaderRuntime.setKeepAwake(value);
      updateKeepAwake(value);
    } catch {
      Alert.alert("Could not save preference", "Please try again.");
    }
  }, []);

  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Reader could not start</Text>
        <Text style={styles.detail}>{error}</Text>
        <Button title="Try again" onPress={() => void start()} />
      </View>
    );
  if (!origin)
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.detail}>Opening Reader…</Text>
      </View>
    );
  return (
    <RuntimeContext.Provider
      value={{
        origin,
        imports,
        pickBooks,
        finishImport,
        keepAwake,
        setKeepAwake,
      }}
    >
      {children}
    </RuntimeContext.Provider>
  );
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Reader runtime is not mounted.");
  return runtime;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
    backgroundColor: PlatformColor("systemBackground"),
  },
  text: { fontSize: 22, fontWeight: "600", color: PlatformColor("label") },
  detail: {
    fontSize: 16,
    color: PlatformColor("secondaryLabel"),
    textAlign: "center",
  },
});
