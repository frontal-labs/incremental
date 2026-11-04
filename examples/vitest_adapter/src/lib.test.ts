import { describe, it, expect } from 'vitest';
import { add } from './lib';

describe('lib', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
});
