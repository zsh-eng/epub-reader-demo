import {
  PlatformColor,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useNativeTheme } from "../../../src/NativeTheme";
import { useRuntime } from "../../../src/RuntimeProvider";

export default function SettingsScreen() {
  const { keepAwake, setKeepAwake } = useRuntime();
  const { palette } = useNativeTheme();
  const canvas = palette ? { backgroundColor: palette.background } : undefined;
  const surface = palette ? { backgroundColor: palette.secondary } : undefined;
  const ink = palette ? { color: palette.foreground } : undefined;
  const detail = palette ? { color: palette.muted } : undefined;
  return (
    <ScrollView
      style={[styles.page, canvas]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.section, detail]}>READING</Text>
      <View style={[styles.row, surface]}>
        <View style={styles.description}>
          <Text style={[styles.label, ink]}>Keep screen awake</Text>
          <Text style={[styles.detail, detail]}>While a book is open.</Text>
        </View>
        <Switch
          accessibilityLabel="Keep screen awake"
          trackColor={
            palette
              ? { true: palette.primary, false: palette.border }
              : undefined
          }
          value={keepAwake}
          onValueChange={setKeepAwake}
        />
      </View>
      <Text style={[styles.note, detail]}>
        Change fonts, page layout, and reading theme from the controls inside a
        book.
      </Text>
      <Text style={[styles.section, detail]}>YOUR LIBRARY</Text>
      <View style={[styles.card, surface]}>
        <Text style={[styles.label, ink]}>Read anywhere</Text>
        <Text style={[styles.detail, detail]}>
          Imported books, highlights, and notes stay on this device and work
          offline.
        </Text>
      </View>
      <Text style={[styles.note, detail]}>
        Keep a copy of your original EPUB files. Removing the app also removes
        its library. Account access and sync are not available in this version.
      </Text>
      <Text style={[styles.version, detail]}>Reader · 0.1.0</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: PlatformColor("systemGroupedBackground") },
  content: { padding: 20, gap: 12 },
  section: {
    color: PlatformColor("secondaryLabel"),
    fontSize: 13,
    marginTop: 16,
    marginLeft: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: PlatformColor("secondarySystemGroupedBackground"),
  },
  card: {
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: PlatformColor("secondarySystemGroupedBackground"),
  },
  description: { flex: 1, gap: 4 },
  label: { fontSize: 17, color: PlatformColor("label") },
  detail: {
    fontSize: 15,
    lineHeight: 21,
    color: PlatformColor("secondaryLabel"),
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    color: PlatformColor("secondaryLabel"),
    marginHorizontal: 12,
  },
  version: {
    marginTop: 32,
    textAlign: "center",
    color: PlatformColor("tertiaryLabel"),
    fontSize: 13,
  },
});
