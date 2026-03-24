import { describe, it, expect } from 'vitest';
import { chunk, unique, flatten, last } from './array-utils.js';

describe('chunk', () => {
  it('splits array into chunks of given size', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('handles last chunk being smaller', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('handles chunk size larger than array', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it('throws on non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('unique', () => {
  it('removes duplicates', () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });
});

describe('flatten', () => {
  it('flattens one level', () => {
    expect(flatten([[1, 2], [3], [4, 5]])).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('last', () => {
  it('returns the last element', () => {
    expect(last([1, 2, 3])).toBe(3);
  });

  it('returns undefined for empty array', () => {
    expect(last([])).toBeUndefined();
  });
});
