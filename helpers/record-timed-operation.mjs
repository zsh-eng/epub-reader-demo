import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const browserTime = (page) =>
  page.evaluate(() => (performance.timeOrigin + performance.now()) / 1000);

/** Record an already prepared Chromium page. See README for measurement limits. */
export async function recordTimedOperation(
  page,
  { output, run, waitUntilComplete, fps = 60, ffmpeg = process.env.FFMPEG ?? "ffmpeg" },
) {
  if (!output || typeof run !== "function" || typeof waitUntilComplete !== "function") {
    throw new Error("output, run, and waitUntilComplete are required");
  }
  if (!Number.isInteger(fps) || fps <= 0) throw new Error("fps must be a positive integer");
  output = resolve(output);
  const directory = await mkdtemp(join(tmpdir(), "med-timed-recording-"));
  const session = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  let captureError;
  let firstFrame;
  const ready = new Promise((accept) => {
    firstFrame = accept;
  });
  session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    void session.send("Page.screencastFrameAck", { sessionId }).catch((error) => {
      captureError ??= error;
    });
    if (!Number.isFinite(metadata.timestamp)) {
      captureError ??= new Error("Screencast frame has no capture timestamp");
      firstFrame();
      return;
    }
    const name = `frame-${String(frames.length).padStart(6, "0")}.jpg`;
    frames.push({ name, timestamp: metadata.timestamp });
    writes.push(writeFile(join(directory, name), Buffer.from(data, "base64")));
    firstFrame();
  });
  let readyTimeout;
  try {
    await session.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        readyTimeout = setTimeout(
          () => reject(new Error("No initial screencast frame within 5 seconds")),
          5000,
        );
      }),
    ]);
    clearTimeout(readyTimeout);
    if (captureError) throw captureError;
    const start = await browserTime(page);
    if (Math.abs(start - frames[0].timestamp) > 60) {
      throw new Error("Browser event clock and screencast timestamps use different time origins");
    }
    await run();
    await waitUntilComplete();
    const complete = await browserTime(page);
    // Capture after the completion condition, so the composite has a final state
    // even when no further screencast frame is emitted for a static page.
    const finalImage = await page.screenshot({ type: "jpeg", quality: 90 });
    const finalTimestamp = await browserTime(page);
    await session.send("Page.stopScreencast");
    await Promise.all(writes);
    if (captureError) throw captureError;
    const finalName = "final.jpg";
    await writeFile(join(directory, finalName), finalImage);
    frames.push({ name: finalName, timestamp: finalTimestamp });
    frames.sort((left, right) => left.timestamp - right.timestamp);
    const unique = frames.filter(
      (frame, index) => index === 0 || frame.timestamp > frames[index - 1].timestamp,
    );
    const origin = unique[0].timestamp;
    const concat = unique.flatMap((frame, index) => [
      `file '${frame.name}'`,
      "option framerate 1000",
      `duration ${index + 1 < unique.length ? unique[index + 1].timestamp - frame.timestamp : 0.5}`,
    ]);
    // A final repeated file is necessary for concat to apply its last duration.
    concat.push(`file '${finalName}'`);
    concat.push("option framerate 1000");
    const list = join(directory, "frames.txt");
    await writeFile(list, `${concat.join("\n")}\n`);
    await mkdir(dirname(output), { recursive: true });
    await new Promise((accept, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-vf",
          `fps=${fps},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
          "-an",
          "-c:v",
          "libx264",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          output,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let error = "";
      child.stderr.on("data", (chunk) => {
        error += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? accept() : reject(new Error(`ffmpeg exited ${code}: ${error}`)),
      );
    });
    const result = {
      video: output,
      startSeconds: start - origin,
      durationSeconds: complete - start,
      capture: {
        clock: "CDP screencast epoch seconds; performance.timeOrigin + performance.now",
        origin,
        start,
        complete,
        finalTimestamp,
        fps,
        frameTimestamps: unique.map((frame) => frame.timestamp - origin),
        note: "Includes callback dispatch and completion polling. Captured frames can be sparse; no missing frames are inferred.",
      },
    };
    await writeFile(`${output}.json`, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    clearTimeout(readyTimeout);
    await session.send("Page.stopScreencast").catch(() => {});
    await session.detach();
    await Promise.allSettled(writes);
    await rm(directory, { recursive: true, force: true });
  }
}
