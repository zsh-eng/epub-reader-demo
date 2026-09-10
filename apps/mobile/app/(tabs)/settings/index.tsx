import {
  PlatformColor,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useRuntime } from "../../../src/RuntimeProvider";

export default function SettingsScreen() {
  const { keepAwake, setKeepAwake } = useRuntime();
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.section}>READING</Text>
      <View style={styles.row}>
        <View style={styles.description}>
          <Text style={styles.label}>Keep screen awake</Text>
          <Text style={styles.detail}>While a book is open.</Text>
        </View>
        <Switch
          accessibilityLabel="Keep screen awake"
          value={keepAwake}
          onValueChange={setKeepAwake}
        />
      </View>
      <Text style={styles.note}>
        Change fonts, page layout, and reading theme from the controls inside a
        book.
      </Text>
      <Text style={styles.section}>YOUR LIBRARY</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Read anywhere</Text>
        <Text style={styles.detail}>
          Imported books, highlights, and notes stay on this device and work
          offline.
        </Text>
      </View>
      <Text style={styles.note}>
        Keep a copy of your original EPUB files. Removing the app also removes
        its library. Account access and sync are not available in this version.
      </Text>
      <Text style={styles.version}>Reader · 0.1.0</Text>
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
