const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Retry failed restores with one timer and drain any active job on shutdown. */
export function startBackupSchedule({service, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let timer, active, closed = false, failures = 0;

  function run() {
    if (closed) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      try {
        await service.run();
        failures = 0;
      } catch {
        // Readiness remains owned by the service's actual restore result.
        // Never log provider errors, which can contain credentials or URLs.
        failures += 1;
      }
    })().finally(() => {
      active = null;
      if (closed) return;
      const delay = failures ? (failures === 1 ? MINUTE : 5 * MINUTE) : DAY;
      timer = setTimer(() => { timer = undefined; void run(); }, delay);
      timer?.unref?.();
    });
    return active;
  }

  return {
    ready: run(),
    async close() {
      closed = true;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      await active;
    },
  };
}
