// Reads the shared utility through the workspace symlink (V03, V07 shape).
import { double } from '@fixture/core/src/util.ts';

it('shared utility through the workspace', () => {
  expect(double(3)).toBe(6);
});
