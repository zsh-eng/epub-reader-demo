import { registerCustomTheme, resolveTheme } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect } from "react";
import { themes, useTheme } from "./themes";

// Registered themes cross Pierre's shadow boundary and are sent to its workers.
// Keep each upstream syntax palette; map editor surfaces and Git indicators to
// the same semantic palette as the shell. Load definitions only when requested.
for (const theme of themes) {
  registerCustomTheme(theme.pierreTheme, async () => {
    const base = await resolveTheme(theme.syntax);
    const { canvas, text, green, red, accent } = theme.palette;
    return {
      ...base,
      name: theme.pierreTheme,
      type: theme.appearance,
      bg: canvas,
      fg: text,
      colors: {
        ...base.colors,
        "editor.background": canvas,
        "editor.foreground": text,
        "terminal.ansiGreen": green,
        "terminal.ansiRed": red,
        "terminal.ansiBlue": accent,
        "gitDecoration.addedResourceForeground": green,
        "gitDecoration.deletedResourceForeground": red,
        "gitDecoration.modifiedResourceForeground": accent,
      },
    };
  });
}

/** Keep the existing pool and its renderers in sync with live theme previews. */
export function PierreThemeSync() {
  const pool = useWorkerPool();
  const { active } = useTheme();
  useEffect(() => {
    // With workers enabled, Pierre uses pool render options instead of each
    // CodeView's theme. The provider reads its own options only on creation.
    // This API also clears stale syntax caches and rejects older async updates.
    void pool?.setRenderOptions({ theme: active.pierreTheme }).catch((error: unknown) => {
      console.error("Could not apply the syntax theme", error);
    });
  }, [pool, active.pierreTheme]);
  return null;
}
