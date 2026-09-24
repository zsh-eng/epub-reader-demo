import ts from "typescript";
const path = new URL("../wrangler.jsonc", import.meta.url);
const parsed = ts.parseConfigFileTextToJson(
  path.pathname,
  await Bun.file(path).text(),
);
if (parsed.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
  );
const config = parsed.config;
if (
  !config.d1_databases?.length ||
  config.d1_databases.some(
    (db: { database_id: string }) =>
      !db.database_id || db.database_id.startsWith("00000000-"),
  )
)
  throw new Error(
    "Production is not configured. Create the new D1/R2 resources, seed and verify them, then set the production bindings.",
  );
