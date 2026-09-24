import { createTwinkleplopAdapter, type AdapterTheme } from "./adapter";
import { prepareSource, tokenize } from "./languages";
export { ensureLanguages } from "./languages";

export async function createHighlighter() {
  const themes = new Map<string, AdapterTheme>();
  const languages = new Set(["text"]);
  const adapter = createTwinkleplopAdapter({
    tokenize,
    getTheme(name) {
      const theme = themes.get(name);
      if (!theme) throw new Error(`Syntax theme is not loaded: ${name}`);
      return theme;
    },
  });
  return {
    ...adapter,
    async prepareSource(language: string, source: string) {
      await prepareSource(language, source);
    },
    loadThemeSync(theme: AdapterTheme) {
      if (!theme.name) throw new Error("Syntax theme needs a name");
      themes.set(theme.name, theme);
    },
    loadLanguageSync(items: { name: string; aliases?: string[] }[]) {
      for (const item of items) {
        languages.add(item.name);
        for (const alias of item.aliases ?? []) languages.add(alias);
      }
    },
    getLanguage(name: string) {
      if (!languages.has(name)) throw new Error(`Language is not loaded: ${name}`);
      return { name };
    },
    getLoadedLanguages: () => [...languages],
    getLoadedThemes: () => [...themes.keys()],
    dispose() {
      themes.clear();
      languages.clear();
    },
  };
}
export const createHighlighterCore = createHighlighter;
// The versioned Pierre shim keeps its old initializer shape. These values are
// ignored; neither Shiki engine is constructed in the Twinkleplop build.
export const createJavaScriptRegexEngine = () => undefined;
export const createOnigurumaEngine = () => undefined;
