import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(".test-artifacts/ui-worktrees");
const repo = join(root, "med-demo"),
  linked = join(root, "review-worktree");
if (existsSync(join(repo, ".git"))) {
  console.log(repo);
  process.exit(0);
}
await mkdir(join(repo, "src"), { recursive: true });
const git = (...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Review fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-C",
      repo,
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();
git("init", "-b", "main");
const file = `export interface ReviewSource {\n  repository: string;\n  revision: string;\n  path: string;\n}\n\nexport async function readReview(source: ReviewSource) {\n  const files = await loadChangedFiles(source);\n  return files.map(file => ({\n    path: file.path,\n    status: file.status,\n    contents: file.contents,\n  }));\n}\n\nfunction loadChangedFiles(source: ReviewSource) {\n  return repository.diff(source.revision);\n}\n`;
await writeFile(join(repo, "src/review.ts"), file);
await writeFile(
  join(repo, "src/theme.ts"),
  'export const theme = {\n  name: "Graphite",\n  density: "comfortable",\n};\n',
);
await writeFile(
  join(repo, "README.md"),
  "# Review workspace fixture\n\nSmall source-only repository for branch and worktree UI validation.\n",
);
git("add", ".");
git("commit", "-qm", "Add review source and theme settings");
await writeFile(
  join(repo, "src/review.ts"),
  file
    .replace(
      "  const files = await loadChangedFiles(source);",
      "  const files = await loadChangedFiles(source);\n  const revision = source.revision;",
    )
    .replace("    path: file.path,", "    id: `${revision}:${file.path}`,\n    path: file.path,"),
);
git("add", ".");
git("commit", "-qm", "Keep file identities stable across review updates");
git("branch", "release");
git("worktree", "add", "-b", "feature/themes", linked, "HEAD");
await writeFile(
  join(linked, "src/theme.ts"),
  'export const theme = {\n  name: "Rosé Pine",\n  density: "compact",\n  preview: true,\n  restoreOnEscape: true,\n};\n',
);
await writeFile(
  join(repo, "src/review.ts"),
  file
    .replace(
      "  const files = await loadChangedFiles(source);",
      '  const files = await loadChangedFiles(source);\n  const changed = files.filter(file => file.status !== "unchanged");',
    )
    .replace("return files.map", "return changed.map")
    .replace(
      "    contents: file.contents,",
      "    contents: file.contents,\n    sourceRevision: source.revision,",
    ),
);
await writeFile(
  join(repo, "src/theme.ts"),
  'export const theme = {\n  name: "Graphite",\n  density: "compact",\n  preview: true,\n};\n',
);
console.log(repo);
