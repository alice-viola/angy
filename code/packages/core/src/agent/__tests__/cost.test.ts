import { describe, it, expect } from 'vitest';
import { estimateCost } from '../cost.js';

describe('estimateCost', () => {
  it('returns correct cost for claude-opus-4-6', () => {
    // 1000 input tokens at $15/M = $0.015, 500 output at $75/M = $0.0375
    const cost = estimateCost('claude-opus-4-6', 1000, 500);
    expect(cost).toBeCloseTo(0.0525);
  });

  it('returns correct cost for claude-sonnet-4-6', () => {
    const cost = estimateCost('claude-sonnet-4-6', 1_000_000, 0);
    expect(cost).toBeCloseTo(3.0);
  });

  it('returns correct cost for gemini-2.0-flash', () => {
    // 1M input at $0.10/M = $0.10, 1M output at $0.40/M = $0.40
    const cost = estimateCost('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.5);
  });

  it('returns correct cost for gemini-2.0-pro', () => {
    const cost = estimateCost('gemini-2.0-pro', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(11.25);
  });

  it('returns undefined for unknown model', () => {
    expect(estimateCost('unknown-model', 1000, 500)).toBeUndefined();
  });

  it('returns 0 for zero tokens', () => {
    const cost = estimateCost('claude-opus-4-6', 0, 0);
    expect(cost).toBe(0);
  });

  it('handles gemini-1.5-pro', () => {
    const cost = estimateCost('gemini-1.5-pro', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(6.25);
  });

  it('handles gemini-1.5-flash', () => {
    const cost = estimateCost('gemini-1.5-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.375);
  });
});
