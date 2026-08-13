/**
 * Configuration reading for tests that touch live AWS infrastructure.
 *
 * Fail-closed: a missing variable throws, and the error names it. The alternative — skipping when
 * the environment looks unconfigured — reports green for a suite that tested nothing, which is
 * precisely the failure mode an auto-deploy pipeline must not have.
 */

/**
 * Returns the value of `name`, or throws naming the variable that is missing.
 *
 * Call this at module scope in an integration test so an unconfigured run fails during collection
 * rather than part-way through a suite that has already created AWS resources.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is not set. Integration tests run against live AWS infrastructure — ` +
        `set ${name} (see .env.example), or run \`bun run test\` for the unit suite, ` +
        `which needs no credentials.`,
    );
  }

  return value;
}
