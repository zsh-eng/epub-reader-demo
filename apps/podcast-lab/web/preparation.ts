import { queries } from "./cache";

type Status = {
  phase: string;
  detail: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  completedChunks?: number;
  totalChunks?: number;
};
let current: AbortController | undefined;
let timer = 0;
export function stopPreparationWatch() {
  current?.abort();
  clearTimeout(timer);
}

/** Watch only the selected episode. Jobs belong to the local server, so leaving
 * the player or reloading the page does not cancel downloads or model work. */
export function watchPreparation(id: string, onReady: () => Promise<void>) {
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
  async function poll(start = false) {
    try {
      const path = `/api/preparations/${id}`;
      const state = await queries.fetchQuery<Status>({
        queryKey: [path],
        staleTime: 0,
        retry: false,
        queryFn: async () => {
          const response = await fetch(path, {
            method: start ? "POST" : "GET",
            signal: controller.signal,
            headers: start ? { "X-Undertone-Preparation": "1" } : {},
          });
          if (!response.ok) throw new Error("Preparation unavailable");
          return response.json();
        },
      });
      if (controller.signal.aborted) return;
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
      retry.hidden = state.phase !== "failed";
      root.querySelectorAll(".preparation-steps i").forEach((step, index) => {
        step.classList.toggle("done", index < steps.indexOf(state.phase));
        step.classList.toggle("active", index === steps.indexOf(state.phase));
      });
      if (state.phase === "ready") {
        await onReady();
        return;
      }
      if (state.phase === "failed") return;
      timer = window.setTimeout(() => void poll(), 1500);
    } catch {
      if (controller.signal.aborted) return;
      label.textContent = "Preparation is unavailable. Audio can keep playing.";
      root.dataset.phase = "failed";
      progress.hidden = true;
      retry.hidden = false;
    }
  }
  retry.onclick = () => {
    retry.hidden = true;
    void poll(true);
  };
  void poll(true);
}
