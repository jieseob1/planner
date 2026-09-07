import assert from 'node:assert/strict';

/** Retry startup checks without weakening their assertions or extending a deadline. */
export async function waitReady(check, {
  timeoutMs = 150000,
  pollMs = 2000,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 150000);
  assert(Number.isInteger(pollMs) && pollMs > 0 && pollMs <= 5000);
  const deadline = now() + timeoutMs;
  let lastError = new Error('No runtime check completed');
  const remainingMs = () => Math.max(0, deadline - now());
  while (remainingMs() > 0) {
    try {
      const result = await check({remainingMs});
      if (remainingMs() > 0) return result;
      lastError = new Error('Runtime checks exceeded the startup deadline');
    } catch (error) { lastError = error; }
    if (remainingMs() > 0) await sleep(Math.min(pollMs, remainingMs()));
  }
  const detail = String(lastError?.message || lastError).replace(/\s+/g, ' ').slice(0, 450);
  throw new Error(`Observability runtime not ready within ${timeoutMs / 1000}s: ${detail}`);
}

// Deterministic controls exercise readiness transition and a non-passing timeout.
export async function verifyWaitReady() {
  let clock = 0;
  let attempts = 0;
  const waits = [];
  const fakeTime = {now: () => clock, sleep: async ms => {waits.push(ms); clock += ms;}};
  const result = await waitReady(async ({remainingMs}) => {
    assert(remainingMs() > 0);
    if (++attempts < 3) throw new Error('first scrape pending');
    return 'actual-data-ready';
  }, {...fakeTime, timeoutMs: 5000, pollMs: 2000});
  assert.equal(result, 'actual-data-ready');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [2000, 2000]);
  clock = 0; attempts = 0; waits.length = 0;
  await assert.rejects(waitReady(async () => {attempts++; throw new Error('Loki rows missing');},
    {...fakeTime, timeoutMs: 5000, pollMs: 2000}), /within 5s: Loki rows missing/);
  assert.equal(attempts, 3);
  assert.equal(clock, 5000);
  assert.deepEqual(waits, [2000, 2000, 1000]);
}
