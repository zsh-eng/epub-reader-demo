import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

// Use the same vector artwork as lucide-react. Run after changing this list or
// upgrading Lucide, then commit the generated, template-rendered Xcode assets.
const root = path.resolve(import.meta.dir, "..");
const icons = [
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "x",
  "ellipsis",
  "panel-left",
  "list",
  "pencil-line",
  "notebook-pen",
  "book-open",
  "book-marked",
  "book-plus",
  "library",
  "highlighter",
  "clock-3",
  "settings",
  "search",
  "type",
  "palette",
  "align-left",
  "align-center",
  "align-right",
  "align-justify",
  "move-vertical",
  "plus",
  "minus",
  "arrow-up",
  "check",
  "arrow-down-up",
  "sun",
  "moon",
  "monitor",
  "keyboard",
  "copy",
  "trash-2",
];
for (const name of icons) {
  let file = path.join(
    root,
    "node_modules/lucide-react/dist/esm/icons",
    `${name}.js`,
  );
  const source = await Bun.file(file).text();
  const alias = source.match(/from '\.\/(.+)'/);
  if (!source.includes("const __iconNode") && alias)
    file = path.join(path.dirname(file), alias[1]);
  const { __iconNode } = await import(file);
  const body = __iconNode
    .map(
      ([tag, props]: [string, Record<string, string>]) =>
        `<${tag} ${Object.entries(props)
          .filter(([key]) => key !== "key")
          .map(([key, value]) => `${key}="${value}"`)
          .join(" ")}/>`,
    )
    .join("");
  const dir = path.join(
    root,
    "apps/ios/Resources/Assets.xcassets",
    `reader-${name}.imageset`,
  );
  await mkdir(dir, { recursive: true });
  await Bun.write(
    path.join(dir, "icon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`,
  );
  await Bun.write(
    path.join(dir, "Contents.json"),
    JSON.stringify(
      {
        images: [{ filename: "icon.svg", idiom: "universal" }],
        info: { author: "xcode", version: 1 },
        properties: {
          "preserves-vector-representation": true,
          "template-rendering-intent": "template",
        },
      },
      null,
      2,
    ) + "\n",
  );
}
await copyFile(
  path.join(root, "node_modules/lucide-react/LICENSE"),
  path.join(root, "apps/ios/Resources/Fonts/lucide-LICENSE.txt"),
);
