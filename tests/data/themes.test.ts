import { describe, expect, test, vi } from "vitest";
import { resolveTheme } from "@pierre/diffs";
import "../../src/web/pierre-theme";
import {
  createThemeController,
  defaultTheme,
  themes,
  THEME_STORAGE_KEY,
} from "../../src/web/themes";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn<(key: string, value: string) => void>((key, value) => {
      values.set(key, value);
    }),
  };
}

describe("theme choices", () => {
  test("previews without persistence and restores the saved theme on cancel", () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "vitesse-light" });
    const apply = vi.fn<(theme: typeof defaultTheme) => void>();
    const controller = createThemeController({ storage, apply });
    controller.initialize();
    controller.preview("tokyo-night");
    controller.preview("rose-pine");
    expect(controller.getSnapshot().active.id).toBe("rose-pine");
    expect(controller.getSnapshot().saved.id).toBe("vitesse-light");
    expect(storage.setItem).not.toHaveBeenCalled();
    controller.cancelPreview();
    expect(controller.getSnapshot().active.id).toBe("vitesse-light");
    expect(apply.mock.lastCall?.[0].id).toBe("vitesse-light");
  });

  test("commit survives dismiss and a new controller session", () => {
    const storage = memoryStorage();
    const controller = createThemeController({ storage });
    controller.initialize();
    controller.commit("rose-pine-dawn");
    controller.cancelPreview();
    expect(controller.getSnapshot().active.id).toBe("rose-pine-dawn");
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY, "rose-pine-dawn");
    const next = createThemeController({ storage });
    next.initialize();
    expect(next.getSnapshot().saved.id).toBe("rose-pine-dawn");
  });

  test("migrates the old light choice and rejects unknown saved names", () => {
    const legacy = createThemeController({ storage: memoryStorage({ "med:theme": "light" }) });
    legacy.initialize();
    expect(legacy.getSnapshot().active.id).toBe("graphite-light");
    const unknown = createThemeController({
      storage: memoryStorage({ [THEME_STORAGE_KEY]: "removed" }),
    });
    unknown.initialize();
    expect(unknown.getSnapshot().active).toBe(defaultTheme);
  });

  test("keeps the session usable when browser storage fails", () => {
    const controller = createThemeController({
      storage: {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
      },
    });
    controller.initialize();
    controller.commit("tokyo-night");
    expect(controller.getSnapshot().saved.id).toBe("tokyo-night");
    expect(controller.getSnapshot().persistenceError).toContain("could not be saved");
    controller.preview("vitesse-light");
    controller.cancelPreview();
    expect(controller.getSnapshot().active.id).toBe("tokyo-night");
  });

  test("resolves every custom Pierre theme with real upstream syntax rules", async () => {
    for (const theme of themes) {
      const resolved = await resolveTheme(theme.pierreTheme);
      const original = await resolveTheme(theme.syntax);
      expect(resolved.name).toBe(theme.pierreTheme);
      expect(resolved.type).toBe(theme.appearance);
      expect(resolved.bg).toBe(theme.palette.canvas);
      expect(resolved.fg).toBe(theme.palette.text);
      expect(resolved.colors?.["gitDecoration.addedResourceForeground"]).toBe(theme.palette.green);
      expect(resolved.settings).toEqual(original.settings);
      expect(resolved.settings.length).toBeGreaterThan(1);
    }
  });
});
