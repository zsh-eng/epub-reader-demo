import * as engine from "benchmark-engine";

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samplesMs: values,
  };
}
self.onmessage = ({ data }) => {
  try {
    if (data.action === "first") {
      const start = performance.now();
      engine.tokens(data.source, data.lang);
      self.postMessage({ firstMs: performance.now() - start });
      return;
    }
    if (data.action === "inspect") {
      self.postMessage({
        spans: engine.inspect(data.source, data.lang),
        html: engine.html(data.source, data.lang),
      });
      return;
    }
    const rows = [];
    for (const file of data.files) {
      const timings = {};
      for (const mode of ["tokens", "html", ...(engine.tree ? ["tree"] : [])]) {
        for (let i = 0; i < 3; i++) engine[mode](file.source, file.lang);
        const samples = [];
        for (let i = 0; i < 11; i++) {
          const start = performance.now();
          engine[mode](file.source, file.lang);
          samples.push(performance.now() - start);
        }
        timings[mode] = stats(samples);
      }
      self.postMessage({ progress: file.name });
      rows.push({ name: file.name, ...timings });
    }
    self.postMessage({ rows });
  } catch (error) {
    self.postMessage({ error: error.stack ?? String(error) });
  }
};
self.postMessage({ ready: true });
