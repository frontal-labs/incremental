import { readFileSync } from 'node:fs';

// Reads a JSON file at runtime (V04).
it('reads config.json at runtime', () => {
  const cfg = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
  expect(typeof cfg.name).toBe('string');
});
