import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import manifest from "../helpers/highlighting/corpus.json";
const directory = ".benchmarks/language-parity/corpus";
await mkdir(directory, { recursive: true });
for (const entry of manifest) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`${entry.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error(`Source hash mismatch: ${entry.name}`);
  await writeFile(`${directory}/${entry.name}`, bytes);
  console.log(`${entry.name}: ${bytes.length} bytes, hash verified`);
}
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
