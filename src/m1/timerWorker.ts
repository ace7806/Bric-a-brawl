const INTERVAL_MS = 16;

let timerId: ReturnType<typeof setInterval> | null = null;
let lastTickMs = 0;

self.addEventListener('message', (ev: MessageEvent<{ type: 'start' | 'stop' }>) => {
  if (ev.data.type === 'start') {
    if (timerId !== null) clearInterval(timerId);
    lastTickMs = performance.now();
    timerId = setInterval(() => {
      const now = performance.now();
      const deltaMs = now - lastTickMs;
      lastTickMs = now;
      self.postMessage({ now, deltaMs });
    }, INTERVAL_MS);
  } else if (ev.data.type === 'stop') {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }
});
