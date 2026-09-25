import { VirtualTranscript } from "./virtual-transcript";
type Word = { text: string; start: number; end: number };
type Row = {
  id: string;
  blockId: string;
  speaker: string;
  start: number;
  end: number;
  parts: Word[];
  text: string;
};
type Speaker = {
  id: string;
  name: string;
  role: string;
  confidence: string;
  avatar?: string;
  avatarSource?: string;
  avatarCredit?: string;
};
type Skip = {
  id: string;
  start: number;
  end: number;
  category: string;
  score: number;
};
type Episode = {
  title: string;
  show: string;
  published: string;
  source: string;
  duration: number;
  audioHash: string;
  summary: string;
  rows: Row[];
  speakers: Speaker[];
  chapters: { title: string; start: number }[];
  skips: Skip[];
  waveform?: number[];
  provenance: Record<string, string>;
};
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const audio = element<HTMLAudioElement>("audio");
const transcript = element<HTMLDivElement>("transcript");
const space = element<HTMLDivElement>("transcript-space");
const seek = element<HTMLInputElement>("seek");
const skipToggle = element<HTMLInputElement>("skip-toggle");
const followButton = element<HTMLButtonElement>("follow");
const fmt = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
let data: Episode;
let active = -1,
  activePart = -1,
  activeChapter = -2;
let following = true,
  raf = 0,
  toastTimer = 0;
let lastSkipped: Skip | undefined;
// Only an explicit preview or Undo may bypass skipping, and only for this
// pass through the range. Ordinary seeks and restored positions still skip.
let previewSkip: Skip | undefined;
let virtual: VirtualTranscript | undefined;
let speakers = new Map<string, Speaker>();
let waveform: HTMLElement[] = [];
let waveIndex = -1;

function setFollowing(value: boolean) {
  following = value;
  followButton.classList.toggle("active", value);
  followButton.setAttribute("aria-pressed", String(value));
  followButton.textContent = value ? "Following" : "Follow along";
  if (value) scrollToActive();
  else virtual?.cancelFollow();
}
function scrollToActive(force = true) {
  if (active < 0) return;
  virtual?.scrollTo(active, activePart, force);
}
function seekTo(time: number, preview?: Skip) {
  if (!data) return;
  previewSkip = preview;
  clearTimeout(toastTimer);
  element("toast").hidden = true;
  audio.currentTime = Math.min(data.duration, Math.max(0, time));
  update();
  if (following) scrollToActive(true);
}
function findRow(time: number) {
  let lo = 0,
    hi = data.rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data.rows[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}
function promotion(row: Row) {
  return data.skips.some((s) => row.start < s.end && row.end > s.start);
}
function createRow(index: number) {
  const row = data.rows[index];
  const speaker = speakers.get(row.speaker);
  const node = document.createElement("article");
  node.className = "transcript-row";
  node.dataset.index = String(index);
  if (promotion(row)) node.classList.add("promotion");
  const header = document.createElement("div");
  header.className = "speaker-line";
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  // Do not attach an interview guest name to an automatically detected ad voice.
  const name = promotion(row)
    ? "Promotion"
    : speaker?.confidence === "unknown"
      ? "Unassigned voice"
      : (speaker?.name ?? "Unassigned voice");
  avatar.textContent = name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
  if (!promotion(row) && speaker?.confidence !== "unknown" && speaker?.avatar) {
    const photo = document.createElement("img");
    photo.alt = "";
    photo.width = 24;
    photo.height = 24;
    photo.decoding = "async";
    photo.addEventListener("error", () => photo.remove(), { once: true });
    photo.src = speaker.avatar;
    avatar.append(photo);
  }
  const label = document.createElement("span");
  label.textContent = name;
  if (!promotion(row) && speaker?.confidence !== "unknown")
    label.title =
      "Name inferred from the introduction; speaker separation can be wrong.";
  const time = document.createElement("time");
  time.textContent = fmt(row.start);
  header.append(avatar, label, time);
  const text = document.createElement("p");
  text.className = "transcript-text";
  row.parts.forEach((part, i) => {
    const span = document.createElement("span");
    span.className = "sentence";
    span.textContent = part.text + (i < row.parts.length - 1 ? " " : "");
    span.tabIndex = 0;
    span.setAttribute("role", "button");
    span.setAttribute(
      "aria-label",
      `Play from ${fmt(part.start)}: ${part.text}`,
    );
    const activate = () => {
      seekTo(part.start);
      setFollowing(true);
      void play();
    };
    span.addEventListener("click", () => {
      if (!window.getSelection()?.toString()) activate();
    });
    span.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    });
    text.append(span);
  });
  node.append(header, text);
  return node;
}
function paintParts() {
  if (!virtual) return;
  for (const [index, node] of virtual.nodes) {
    const isActive = index === active;
    node.classList.toggle("active", isActive);
    node.querySelectorAll(".sentence").forEach((part, i) => {
      part.classList.toggle("current", isActive && i === activePart);
      if (isActive && i === activePart)
        part.setAttribute("aria-current", "true");
      else part.removeAttribute("aria-current");
    });
  }
}
function showSkip(skip: Skip) {
  lastSkipped = skip;
  element("toast-text").textContent = `Skipped ${fmt(skip.end - skip.start)}`;
  element("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (!element("toast").contains(document.activeElement))
      element("toast").hidden = true;
  }, 10000);
}
function update() {
  if (!data) return;
  let time = audio.currentTime;
  if (previewSkip && (time < previewSkip.start || time >= previewSkip.end))
    previewSkip = undefined;
  if (!audio.paused && skipToggle.checked) {
    const skip = data.skips.find(
      (s) => s.id !== previewSkip?.id && time >= s.start && time < s.end,
    );
    if (skip) {
      audio.currentTime = skip.end + 0.04;
      time = audio.currentTime;
      showSkip(skip);
    }
  }
  const next = findRow(time);
  const changed = next !== active;
  active = next;
  const parts = data.rows[active].parts;
  const partIndex = parts.findIndex(
    (part) => time >= part.start && time < part.end,
  );
  if (changed || partIndex !== activePart) {
    activePart = partIndex;
    paintParts();
    if (following && (changed || partIndex >= 0)) scrollToActive(false);
  }
  seek.value = String(time);
  const elapsed = fmt(time);
  if (element("elapsed").textContent !== elapsed)
    element("elapsed").textContent = elapsed;
  seek.setAttribute("aria-valuetext", `${elapsed} of ${fmt(data.duration)}`);
  const nextChapter = data.chapters.findLastIndex((c) => c.start <= time);
  if (nextChapter !== activeChapter) {
    activeChapter = nextChapter;
    element("now-chapter").textContent =
      data.chapters[nextChapter]?.title ?? "Opening";
    document.querySelectorAll(".chapter").forEach((node, i) => {
      node.classList.toggle("active", i === nextChapter);
      if (i === nextChapter) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  }
  if (changed)
    element("now-speaker").textContent = promotion(data.rows[active])
      ? "Promotion"
      : (speakers.get(data.rows[active].speaker)?.name ?? "Unassigned voice");
  const nextWave = Math.floor((time / data.duration) * waveform.length);
  if (nextWave !== waveIndex) {
    waveIndex = nextWave;
    waveform.forEach((bar, i) => bar.classList.toggle("played", i < nextWave));
  }
}
function tick() {
  update();
  if (!audio.paused) raf = requestAnimationFrame(tick);
}
async function play() {
  try {
    await audio.play();
  } catch {
    showError(
      "Audio could not play. Check that the local episode download is complete, then press Play again.",
    );
  }
}
function showError(message: string) {
  element("error").textContent = message;
  element("error").hidden = false;
}
function savePosition() {
  if (data && Number.isFinite(audio.currentTime))
    try {
      localStorage.setItem(
        `undertone:${data.audioHash}`,
        JSON.stringify({
          time: audio.currentTime,
          rate: audio.playbackRate,
          skip: skipToggle.checked,
        }),
      );
    } catch {
      /* Storage can be disabled; playback remains available. */
    }
}
async function start() {
  const response = await fetch("/episode.json");
  if (!response.ok)
    throw new Error(
      "Run the episode pipeline first. See apps/podcast-lab/README.md.",
    );
  data = await response.json();
  speakers = new Map(data.speakers.map((s) => [s.id, s]));
  const credits = element("photo-credits");
  const credited = new Set<string>();
  for (const speaker of data.speakers) {
    if (!speaker.avatar || !speaker.avatarSource || credited.has(speaker.name))
      continue;
    credited.add(speaker.name);
    const link = document.createElement("a");
    link.href = speaker.avatarSource;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = speaker.name;
    link.title = speaker.avatarCredit ?? speaker.name;
    if (credits.childNodes.length) credits.append(" · ");
    else credits.append("Photos: ");
    credits.append(link);
  }
  element("title").textContent = data.title;
  element("show").textContent = data.show.toUpperCase();
  element("summary").textContent = data.summary;
  element("episode-meta").textContent =
    `${new Date(data.published).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${Math.round(data.duration / 60)} min`;
  element<HTMLAnchorElement>("source").href = data.source;
  element("duration").textContent = fmt(data.duration);
  seek.max = String(data.duration);
  element("savings").textContent =
    `${fmt(data.skips.reduce((sum, s) => sum + s.end - s.start, 0))} · ${data.skips.length} detected`;
  element("chapter-count").textContent = String(data.chapters.length).padStart(
    2,
    "0",
  );
  for (const chapter of data.chapters) {
    const button = document.createElement("button");
    button.className = "chapter";
    const time = document.createElement("time");
    time.textContent = fmt(chapter.start);
    const title = document.createElement("span");
    title.textContent = chapter.title;
    button.append(time, title);
    button.addEventListener("click", () => {
      seekTo(chapter.start);
      setFollowing(true);
    });
    element("chapters").append(button);
  }
  for (const skip of data.skips) {
    const button = document.createElement("button");
    button.className = "detection";
    const name = document.createElement("span");
    name.textContent = skip.category === "sponsor" ? "Sponsor" : "Promotion";
    const time = document.createElement("time");
    time.textContent = `${fmt(skip.start)} — ${fmt(skip.end)}`;
    const hint = document.createElement("small");
    hint.textContent = "Listen ↗";
    button.append(name, time, hint);
    button.addEventListener("click", () => {
      seekTo(skip.start, skip);
      setFollowing(true);
      void play();
    });
    element("detections").append(button);
    const mark = document.createElement("i");
    mark.style.left = `${(skip.start / data.duration) * 100}%`;
    mark.style.width = `${((skip.end - skip.start) / data.duration) * 100}%`;
    element("skip-marks").append(mark);
  }
  const peaks = data.waveform ?? [];
  for (const peak of peaks) {
    const bar = document.createElement("i");
    bar.style.height = `${Math.max(3, peak * 29)}px`;
    element("waveform").append(bar);
    waveform.push(bar);
  }
  virtual = new VirtualTranscript(
    transcript,
    space,
    data.rows.map((row) => row.text),
    createRow,
    paintParts,
  );
  update();
  const restore = () => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`undertone:${data.audioHash}`) ?? "null",
      );
      if (saved) {
        skipToggle.checked = saved.skip !== false;
        audio.playbackRate = [1, 1.25, 1.5, 2].includes(saved.rate)
          ? saved.rate
          : 1;
        element("speed").textContent = `${audio.playbackRate}×`;
        seekTo(saved.time >= data.duration - 1 ? 0 : saved.time);
      }
    } catch {
      /* A stale local preference cannot block playback. */
    }
  };
  if (audio.readyState >= 1) restore();
  else audio.addEventListener("loadedmetadata", restore, { once: true });
}
element("play").addEventListener("click", () =>
  audio.paused ? void play() : audio.pause(),
);
audio.addEventListener("play", () => {
  element("error").hidden = true;
  element("play").setAttribute("aria-label", "Pause");
  element("play")
    .querySelector("path")
    ?.setAttribute("d", "M7 5h4v14H7zM15 5h4v14h-4z");
  cancelAnimationFrame(raf);
  tick();
});
audio.addEventListener("pause", () => {
  element("play").setAttribute("aria-label", "Play");
  element("play").querySelector("path")?.setAttribute("d", "m9 5 11 7-11 7z");
  cancelAnimationFrame(raf);
  savePosition();
});
audio.addEventListener("timeupdate", update);
audio.addEventListener("seeked", update);
element("back").addEventListener("click", () => seekTo(audio.currentTime - 15));
element("forward").addEventListener("click", () =>
  seekTo(audio.currentTime + 15),
);
seek.addEventListener("input", () => seekTo(Number(seek.value)));
element("speed").addEventListener("click", () => {
  const rates = [1, 1.25, 1.5, 2];
  audio.playbackRate =
    rates[(rates.indexOf(audio.playbackRate) + 1) % rates.length];
  element("speed").textContent = `${audio.playbackRate}×`;
  savePosition();
});
skipToggle.addEventListener("change", () => {
  previewSkip = undefined;
  savePosition();
  update();
});
element("undo").addEventListener("click", () => {
  if (!lastSkipped) return;
  seekTo(lastSkipped.start, lastSkipped);
  element("toast").hidden = true;
});
followButton.addEventListener("click", () => setFollowing(!following));
transcript.addEventListener("wheel", () => setFollowing(false), {
  passive: true,
});
transcript.addEventListener("touchstart", () => setFollowing(false), {
  passive: true,
});
transcript.addEventListener("keydown", (event) => {
  if (
    ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(
      event.key,
    )
  )
    setFollowing(false);
});
document.addEventListener("keydown", (event) => {
  if (
    event.code !== "Space" ||
    (event.target as HTMLElement).closest("button,input,a,summary")
  )
    return;
  event.preventDefault();
  if (audio.paused) void play();
  else audio.pause();
});
window.addEventListener("pagehide", savePosition);
document.addEventListener("visibilitychange", savePosition);
window.setInterval(savePosition, 5000);
start().catch((error) => showError(error.message));

const mobileSkips = element<HTMLButtonElement>("mobile-skips");
function closeSkips() {
  element("skip-panel").classList.remove("open");
  mobileSkips.setAttribute("aria-expanded", "false");
}
mobileSkips.addEventListener("click", () => {
  const open = element("skip-panel").classList.toggle("open");
  mobileSkips.setAttribute("aria-expanded", String(open));
  if (open) skipToggle.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!(event.target as HTMLElement).closest("#skip-panel,#mobile-skips"))
    closeSkips();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    element("skip-panel").classList.contains("open")
  ) {
    closeSkips();
    mobileSkips.focus();
  }
});
transcript.addEventListener("pointerdown", () => setFollowing(false), {
  passive: true,
});
