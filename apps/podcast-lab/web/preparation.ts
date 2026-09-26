type Status = {
  phase: string;
  detail: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  completedChunks?: number;
  totalChunks?: number;
  draftRevision?: number;
};
let current: AbortController | undefined;
let timer = 0;
let startSelected: (() => void) | undefined;
export function requestPreparation() {
  startSelected?.();
}
export function stopPreparationWatch() {
  current?.abort();
  clearTimeout(timer);
  startSelected = undefined;
}

/** Watch only the selected episode. Jobs belong to the local server, so leaving
 * the player or reloading the page does not cancel downloads or model work. */
export function watchPreparation(
  id: string,
  onReady: () => Promise<void>,
  start = false,
) {
  stopPreparationWatch();
  const controller = new AbortController();
  current = controller;
  const root = document.getElementById("preparation-status")!;
  const label = root.querySelector<HTMLElement>("[role=status]")!;
  const retry = root.querySelector<HTMLButtonElement>("button")!;
  const progress = root.querySelector<HTMLProgressElement>("progress")!;
  const steps = [
    "queued",
    "downloading",
    "converting",
    "transcribing",
    "speakers",
    "analysing",
    "finishing",
    "ready",
  ];
  let revision = 0;
  let phase: string | undefined;
  let draftRevision = -1;
  const draft = document.createElement("section");
  draft.className = "draft-transcript";
  draft.setAttribute("aria-label", "Draft transcript");
  draft.hidden = true;
  root.parentElement!.append(draft);
  async function poll(start = false) {
    clearTimeout(timer);
    const version = ++revision;
    try {
      const path = `/api/preparations/${id}`;
      const response = await fetch(path, {
        method: start ? "POST" : "GET",
        signal: controller.signal,
        headers: start ? { "X-Undertone-Preparation": "1" } : {},
      });
      if (!response.ok) throw new Error("Preparation unavailable");
      const state: Status = await response.json();
      if (controller.signal.aborted || version !== revision) return;
      phase = state.phase;
      root.dataset.phase = state.phase;
      label.textContent = state.detail;
      progress.hidden = true;
      if (state.phase === "downloading") {
        progress.hidden = false;
        progress.setAttribute("aria-label", "Audio download");
        const received = state.downloadedBytes ?? 0;
        const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
        if (state.totalBytes && state.totalBytes > 0) {
          const fraction = Math.min(1, received / state.totalBytes);
          progress.value = fraction;
          label.textContent = `Downloading · ${Math.floor(fraction * 100)}% · ${size(received)} / ${size(state.totalBytes)}`;
        } else {
          progress.removeAttribute("value");
          label.textContent = `Downloading · ${size(received)}`;
        }
      } else if (state.phase === "transcribing" && state.totalChunks) {
        const total = state.totalChunks;
        const completed = Math.min(
          total,
          Math.max(0, state.completedChunks ?? 0),
        );
        progress.hidden = false;
        progress.setAttribute("aria-label", "Transcription progress");
        progress.value = completed / total;
        label.textContent =
          completed === total
            ? "Transcription complete · 100%"
            : `Transcribing · chunk ${completed + 1} of ${total} · ${Math.floor((completed / total) * 100)}%`;
      }
      retry.hidden = state.phase !== "failed" && state.phase !== "idle";
      retry.textContent =
        state.phase === "idle" ? "Prepare transcript" : "Retry preparation";
      if (state.phase === "idle")
        label.textContent = "Play to prepare a transcript";
      root.querySelectorAll(".preparation-steps i").forEach((step, index) => {
        step.classList.toggle("done", index < steps.indexOf(state.phase));
        step.classList.toggle("active", index === steps.indexOf(state.phase));
      });
      if (state.phase === "ready") {
        await onReady();
        return;
      }
      // Stages after ASR replace status fields. Keep the existing draft, or fetch
      // it once when reopening an episode whose speaker analysis is in progress.
      if (
        (state.draftRevision !== undefined &&
          state.draftRevision !== draftRevision) ||
        (draftRevision < 0 &&
          ["speakers", "analysing", "finishing"].includes(state.phase))
      ) {
        const response = await fetch(`${path}/draft`, {
          signal: controller.signal,
        }).catch(() => undefined);
        // A draft is optional. Its transfer must not stop job status polling.
        if (response?.ok) {
          const snapshot: { revision: number; paragraphs: string[] } =
            await response.json();
          if (controller.signal.aborted || version !== revision) return;
          draftRevision = snapshot.revision;
          if (snapshot.paragraphs.length) {
            draft.hidden = false;
            root.parentElement!.classList.add("has-draft");
            // Keep unchanged text nodes (and selections) while more text arrives.
            snapshot.paragraphs.forEach((text, index) => {
              let paragraph = draft.children[index] as
                | HTMLParagraphElement
                | undefined;
              if (!paragraph) {
                paragraph = document.createElement("p");
                draft.append(paragraph);
              }
              if (paragraph.textContent !== text) paragraph.textContent = text;
            });
            while (draft.children.length > snapshot.paragraphs.length)
              draft.lastElementChild!.remove();
          }
        }
      }
      if (state.phase === "failed" || state.phase === "idle") return;
      timer = window.setTimeout(() => void poll(), 1500);
    } catch {
      if (controller.signal.aborted || version !== revision) return;
      label.textContent = "Preparation is unavailable. Audio can keep playing.";
      root.dataset.phase = "failed";
      progress.hidden = true;
      retry.hidden = false;
      retry.textContent = "Retry preparation";
    }
  }
  retry.onclick = () => {
    retry.hidden = true;
    void poll(true);
  };
  startSelected = () => {
    if (phase !== undefined && phase !== "idle") return;
    phase = "queued";
    retry.hidden = true;
    void poll(true);
  };
  if (start) startSelected();
  else void poll();
}
