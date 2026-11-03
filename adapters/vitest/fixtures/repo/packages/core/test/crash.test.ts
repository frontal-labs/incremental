import { readFileSync } from 'node:fs';

// Crashes on demand (V15): the flag file says "crash".
it('crashes on demand', () => {
  const flag = readFileSync(new URL('./crash.flag', import.meta.url), 'utf8').trim();
  if (flag === 'crash') process.abort();
  expect(flag).toBe('ok');
});
