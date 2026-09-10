export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  // RuntimeProvider stages file URLs. File paths must never become app routes.
  if (path.startsWith("file://")) return "/";
  return path;
}
