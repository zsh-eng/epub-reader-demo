import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DarkTheme, DefaultTheme } from "@react-navigation/native";
import { useColorScheme } from "react-native";
import ReaderRuntime from "../modules/reader-runtime";

export interface NativePalette {
  background: string;
  foreground: string;
  secondary: string;
  muted: string;
  primary: string;
  border: string;
  dark: boolean;
}

function paletteFrom(value: unknown): NativePalette | null {
  if (!value || typeof value !== "object") return null;
  const colors = value as Record<string, unknown>;
  if (typeof colors.dark !== "boolean") return null;
  for (const key of [
    "background",
    "foreground",
    "secondary",
    "muted",
    "primary",
    "border",
  ]) {
    if (
      typeof colors[key] !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(colors[key] as string)
    )
      return null;
  }
  return {
    background: colors.background,
    foreground: colors.foreground,
    secondary: colors.secondary,
    muted: colors.muted,
    primary: colors.primary,
    border: colors.border,
    dark: colors.dark,
  } as NativePalette;
}

const ThemeContext = createContext<{
  palette: NativePalette | null;
  theme: typeof DefaultTheme;
  updateAppearance(value: unknown): void;
} | null>(null);

/** CSS remains the palette source. A small native cache colors the first frame
 * before WebKit starts, then the active screen supplies the authoritative theme.
 */
export function NativeThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [palette, setPalette] = useState(() => {
    try {
      return paletteFrom(JSON.parse(ReaderRuntime.getAppearance()));
    } catch {
      return null;
    }
  });
  const updateAppearance = useCallback((value: unknown) => {
    const next = paletteFrom(value);
    if (!next) return;
    setPalette((previous) => {
      if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
      ReaderRuntime.setAppearance(JSON.stringify(next));
      return next;
    });
  }, []);
  const base = (palette?.dark ?? scheme === "dark") ? DarkTheme : DefaultTheme;
  const theme = useMemo(
    () =>
      palette
        ? {
            ...base,
            colors: {
              ...base.colors,
              background: palette.background,
              card: palette.background,
              text: palette.foreground,
              primary: palette.primary,
              border: palette.border,
            },
          }
        : base,
    [base, palette],
  );
  return (
    <ThemeContext value={{ palette, theme, updateAppearance }}>
      {children}
    </ThemeContext>
  );
}

export function useNativeTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("NativeThemeProvider is required");
  return context;
}
