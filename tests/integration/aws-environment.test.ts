import { describe, expect, it } from 'vitest';

import { requireEnv } from '../helpers/env.ts';

/**
 * Read at module scope on purpose: an unconfigured run fails during collection, before any test
 * body has had the chance to create something in a real AWS account.
 */
const region = requireEnv('AWS_REGION');

const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

describe('AWS environment', () => {
  it('is pointed at a plausible region', () => {
    expect(region).toMatch(REGION_PATTERN);
  });
});

// Assertions against real resources land here once the stack in `src/` exists and has
// outputs to read — runner registration, instance health, and the IAM role the fleet assumes.
