import { queries } from "./cache";

type Status = {
  phase: string;
  detail: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
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
  const download = root.querySelector<HTMLProgressElement>("progress")!;
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
      download.hidden = state.phase !== "downloading";
      if (!download.hidden) {
        const received = state.downloadedBytes ?? 0;
        const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
        if (state.totalBytes && state.totalBytes > 0) {
          const fraction = Math.min(1, received / state.totalBytes);
          download.value = fraction;
          label.textContent = `Downloading · ${Math.floor(fraction * 100)}% · ${size(received)} / ${size(state.totalBytes)}`;
        } else {
          download.removeAttribute("value");
          label.textContent = `Downloading · ${size(received)}`;
        }
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
      download.hidden = true;
      retry.hidden = false;
    }
  }
  retry.onclick = () => {
    retry.hidden = true;
    void poll(true);
  };
  void poll(true);
}
