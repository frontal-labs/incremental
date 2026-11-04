import { describe, it, expect } from 'vitest';
import { greet } from './app';

describe('app', () => {
  it('greets a name', () => {
    expect(greet('world')).toBe('Hello, world!');
  });
});
