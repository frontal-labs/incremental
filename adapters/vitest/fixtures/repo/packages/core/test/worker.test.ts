import { Worker } from 'node:worker_threads';

// Starts a worker thread (V16). The worker code is inline, so the test reads no files.
it('runs work in a worker thread', async () => {
  const value = await new Promise<number>((resolve, reject) => {
    const w = new Worker(
      "const { parentPort } = require('node:worker_threads'); parentPort.postMessage(42);",
      { eval: true },
    );
    w.once('message', (m: number) => resolve(m));
    w.once('error', reject);
  });
  expect(value).toBe(42);
});
