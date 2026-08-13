import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireEnv } from '../support/env.ts';

const VARIABLE = 'NIGHT_SHIFT_TEST_VARIABLE';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireEnv', () => {
  it('returns the value when the variable is set', () => {
    vi.stubEnv(VARIABLE, 'us-east-1');

    expect(requireEnv(VARIABLE)).toBe('us-east-1');
  });

  it('throws naming the variable when it is unset', () => {
    vi.stubEnv(VARIABLE, undefined);

    expect(() => requireEnv(VARIABLE)).toThrow(new RegExp(VARIABLE));
  });

  it('treats a blank value as unset, so an empty export cannot pass for configuration', () => {
    vi.stubEnv(VARIABLE, '   ');

    expect(() => requireEnv(VARIABLE)).toThrow(new RegExp(VARIABLE));
  });
});
