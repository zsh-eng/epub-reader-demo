/** Summarize timings without including snapshot contents. */
const input = process.argv[2] ?? "cutover.local/sync-benchmark-results.json";
const { results } = await Bun.file(input).json();
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
for (const delay of [...new Set(results.map((r: any) => r.delay))]) {
  for (const mode of [...new Set(results.map((r: any) => r.mode))]) {
    const runs = results.filter(
      (r: any) => r.delay === delay && r.mode === mode,
    );
    if (!runs.length) continue;
    if (runs.some((r: any) => !r.verified)) throw new Error("Unverified run");
    console.log(
      JSON.stringify({
        mode,
        delay,
        runs: runs.length,
        medianSeconds: median(runs.map((r: any) => r.totalMs)) / 1000,
        rangeSeconds: [
          Math.min(...runs.map((r: any) => r.totalMs)) / 1000,
          Math.max(...runs.map((r: any) => r.totalMs)) / 1000,
        ],
        medianPrepareSeconds: median(runs.map((r: any) => r.prepareMs)) / 1000,
        medianWriteAwaitSeconds: median(runs.map((r: any) => r.writeMs)) / 1000,
        writes: runs.map((r: any) => r.writes),
        requests: runs.map((r: any) => r.requests),
        maxPrepareMs: Math.max(...runs.map((r: any) => r.maxPrepareMs ?? 0)),
        maxWriteAwaitMs: Math.max(...runs.map((r: any) => r.maxWriteMs ?? 0)),
        maxQueueJsonBytes: Math.max(
          ...runs.map((r: any) => r.peakQueueJsonBytes),
        ),
      }),
    );
  }
}
export {};
