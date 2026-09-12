import path from "node:path";

// The native app has no package dependencies. Bun only prepares the shared web
// bundle and invokes Xcode; Xcode can also open/build the checked-in project.
const root = path.resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const release = args.includes("--release");
const buildOnly = args.includes("--build-only");
const deviceIndex = args.indexOf("--device");
const requestedDevice = deviceIndex >= 0 ? args[deviceIndex + 1] : undefined;
const configuration = release ? "Release" : "Debug";
const derived = path.join(root, "apps/ios/build");

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}

await run(["bun", "run", "build:mobile:web"]);
await run([
  "xcodebuild",
  "-project",
  "apps/ios/Reader.xcodeproj",
  "-scheme",
  "Reader",
  "-configuration",
  configuration,
  "-sdk",
  "iphonesimulator",
  "-destination",
  "generic/platform=iOS Simulator",
  "-derivedDataPath",
  derived,
  "CODE_SIGNING_ALLOWED=NO",
  "build",
]);
if (buildOnly) process.exit(0);

const list = Bun.spawn(
  ["xcrun", "simctl", "list", "devices", "available", "--json"],
  { stdout: "pipe", stderr: "inherit" },
);
const data = (await new Response(list.stdout).json()) as {
  devices: Record<string, { name: string; udid: string; state: string }[]>;
};
if ((await list.exited) !== 0) process.exit(1);
const devices = Object.values(data.devices).flat();
const device = requestedDevice
  ? devices.find(
      ({ name, udid }) => name === requestedDevice || udid === requestedDevice,
    )
  : devices.find(({ state }) => state === "Booted");
if (!device) {
  console.error(
    "Open an iOS simulator, or pass --device <simulator UUID>. The app build is complete.",
  );
  process.exit(1);
}
if (device.state !== "Booted")
  await run(["xcrun", "simctl", "boot", device.udid]);
await run(["xcrun", "simctl", "bootstatus", device.udid, "-b"]);
await run([
  "xcrun",
  "simctl",
  "install",
  device.udid,
  path.join(
    derived,
    "Build/Products",
    `${configuration}-iphonesimulator/Reader.app`,
  ),
]);
await run([
  "xcrun",
  "simctl",
  "launch",
  "--terminate-running-process",
  device.udid,
  "app.zsheng.reader.mobile",
]);
