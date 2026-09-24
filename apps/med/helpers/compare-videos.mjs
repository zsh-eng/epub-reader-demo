#!/usr/bin/env node
// Usage and capture requirements: helpers/README.md
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

async function run(binary, args) {
  return await new Promise((accept, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) accept(stdout);
      else reject(new Error(`${binary} exited ${code}: ${stderr}`));
    });
  });
}

function positive(value, name, fallback, allowZero = false) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) {
    throw new Error(`${name} must be a ${allowZero ? "non-negative" : "positive"} number`);
  }
  return result;
}

/** Compose independently recorded operations with a common playback clock. */
export async function compareVideos(manifest, baseDirectory = process.cwd()) {
  const ffmpeg = manifest.ffmpeg ?? process.env.FFMPEG ?? "ffmpeg";
  const ffprobe = manifest.ffprobe ?? process.env.FFPROBE ?? "ffprobe";
  const slow = positive(manifest.slowMotion, "slowMotion", 3);
  const fps = positive(manifest.fps, "fps", 30);
  const width = positive(manifest.panelWidth, "panelWidth", 960);
  const hold = positive(manifest.holdSeconds, "holdSeconds", 3, true);
  if (!Number.isInteger(fps) || !Number.isInteger(width) || width % 2) {
    throw new Error("fps must be an integer; panelWidth must be an even integer");
  }
  if (!manifest.output) throw new Error("output is required");
  const output = resolve(baseDirectory, manifest.output);
  const sides = [];
  for (const name of ["left", "right"]) {
    const side = manifest[name];
    if (!side?.video || !side.label) throw new Error(`${name} needs video and label`);
    const video = resolve(baseDirectory, side.video);
    if (video === output) throw new Error("output must differ from source videos");
    const start = positive(side.startSeconds, `${name}.startSeconds`, 0, true);
    const duration = positive(side.durationSeconds, `${name}.durationSeconds`);
    const probe = JSON.parse(
      await run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", video]),
    );
    const stream = probe.streams.find((item) => item.codec_type === "video");
    if (!stream) throw new Error(`${name} has no video stream`);
    const sourceDuration = Number(stream.duration ?? probe.format.duration);
    if (sourceDuration <= start + duration) {
      throw new Error(`${name} must include a recorded frame after completion`);
    }
    sides.push({ name, video, label: side.label, start, duration, stream, sourceDuration });
  }
  const height =
    Math.ceil(
      Math.max(...sides.map((side) => (side.stream.height / side.stream.width) * width)) / 2,
    ) * 2;
  const headerHeight = 100;
  const frames =
    Math.ceil(Math.max(...sides.map((side) => side.duration)) * slow * fps) +
    Math.max(1, Math.round(hold * fps));
  const temporary = await mkdtemp(join(tmpdir(), "med-video-comparison-"));
  await mkdir(dirname(output), { recursive: true });
  let browser;
  try {
    // Canvas avoids requiring ffmpeg builds with libfreetype/drawtext support.
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.evaluate(
      ({ width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        document.body.append(canvas);
      },
      { width: width * 2, height: headerHeight },
    );
    for (let frame = 0; frame < frames; frame++) {
      const png = await page.evaluate(
        ({ sides, width, slow, fps, frame }) => {
          const canvas = document.querySelector("canvas");
          const context = canvas.getContext("2d");
          context.fillStyle = "#15171d";
          context.fillRect(0, 0, canvas.width, canvas.height);
          for (let index = 0; index < sides.length; index++) {
            const side = sides[index];
            const done = frame >= Math.ceil(side.duration * slow * fps);
            const elapsed = done ? side.duration : Math.min(frame / fps / slow, side.duration);
            const x = index * width + 24;
            context.fillStyle = "#f3f4f6";
            context.font = "600 22px system-ui, sans-serif";
            context.fillText(side.label, x, 32, width - 48);
            context.fillStyle = done ? "#9ee7b0" : "#d4d9e4";
            context.font = "24px ui-monospace, monospace";
            context.fillText(
              `${elapsed.toFixed(3)} s${done ? "  Complete" : ""}`,
              x,
              62,
              width - 48,
            );
            context.fillStyle = "#a4acbd";
            context.font = "14px system-ui, sans-serif";
            context.fillText(`${slow}× slower · real elapsed time`, x, 87, width - 48);
            context.textAlign = "left";
          }
          context.fillStyle = "#454b58";
          context.fillRect(width - 1, 0, 2, canvas.height);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        {
          sides: sides.map(({ label, duration }) => ({ label, duration })),
          width,
          slow,
          fps,
          frame,
        },
      );
      await writeFile(
        join(temporary, `header-${String(frame).padStart(6, "0")}.png`),
        Buffer.from(png, "base64"),
      );
    }
    await browser.close();
    browser = undefined;
    const filters = [];
    for (let index = 0; index < sides.length; index++) {
      const side = sides[index];
      const movingFrames = Math.ceil(side.duration * slow * fps);
      const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x15171d,setsar=1`;
      filters.push(`[${index}:v]split[run${index}][end${index}]`);
      filters.push(
        `[run${index}]trim=start=${side.start},setpts=(PTS-STARTPTS)*${slow},fps=${fps},${fit},tpad=stop_mode=clone:stop_duration=${frames / fps},trim=end_frame=${movingFrames},setpts=N/(${fps}*TB)[moving${index}]`,
      );
      // The first recorded frame at/after completion is used for the final state.
      filters.push(
        `[end${index}]trim=start=${side.start + side.duration},setpts=PTS-STARTPTS,select=eq(n\\,0),${fit},fps=${fps},tpad=stop_mode=clone:stop_duration=${frames / fps},trim=end_frame=${frames - movingFrames},setpts=N/(${fps}*TB)[still${index}]`,
      );
      filters.push(`[moving${index}][still${index}]concat=n=2:v=1:a=0[side${index}]`);
    }
    filters.push("[side0][side1]hstack=inputs=2[panels]");
    filters.push("[2:v][panels]vstack=inputs=2:shortest=1[out]");
    const filterPath = join(temporary, "filters.txt");
    await writeFile(filterPath, filters.join(";\n"));
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sides[0].video,
      "-i",
      sides[1].video,
      "-framerate",
      String(fps),
      "-i",
      join(temporary, "header-%06d.png"),
      "-filter_complex_script",
      filterPath,
      "-map",
      "[out]",
      "-an",
      "-frames:v",
      String(frames),
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      output,
    ]);
    const result = {
      output,
      fps,
      slowMotion: slow,
      frames,
      durationSeconds: frames / fps,
      width: width * 2,
      height: height + headerHeight,
      sides: sides.map(({ name, video, label, start, duration }) => ({
        name,
        video,
        label,
        startSeconds: start,
        durationSeconds: duration,
        completeAtOutputFrame: Math.ceil(duration * slow * fps),
      })),
    };
    await writeFile(`${output}.json`, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await browser?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--manifest");
  if (index < 0 || !process.argv[index + 1]) {
    console.error("Usage: node helpers/compare-videos.mjs --manifest /path/to/comparison.json");
    process.exitCode = 1;
  } else {
    const path = resolve(process.argv[index + 1]);
    const result = await compareVideos(JSON.parse(await readFile(path, "utf8")), dirname(path));
    console.log(JSON.stringify(result, null, 2));
  }
}
