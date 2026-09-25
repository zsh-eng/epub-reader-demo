// Opt-in only. One bridge message per second; raw samples are sent only while
// recording. Stop removes the animation callback and all per-frame work.
(() => {
  if (globalThis.arcticDiagnostics) return;
  let frame = 0, last = 0, began = 0, samples = [], recording = false, target = 120;
  function tick(now) {
    if (last) samples.push(now - last);
    last = now;
    if (!began) began = now;
    if (now - began >= 1000) {
      const ordered = [...samples].sort((a,b) => a-b);
      const total = samples.reduce((a,b) => a+b, 0);
      globalThis.webkit?.messageHandlers?.arcticMac?.postMessage({ diagnostics: {
        fps: total ? Math.round(samples.length * 1000 / total) : 0,
        p95: ordered[Math.floor(ordered.length * .95)] || 0,
        gaps: samples.filter(ms => ms > 1500 / target).length,
        frames: recording ? samples : []
      }});
      samples = []; began = now;
    }
    frame = requestAnimationFrame(tick);
  }
  globalThis.arcticDiagnostics = {
    start(hz = 120) { target = hz; if (!frame) frame = requestAnimationFrame(tick); },
    record(value) { recording = value; samples = []; last = began = 0; },
    stop() { cancelAnimationFrame(frame); frame = last = began = 0; samples = []; recording = false; }
  };
})();
