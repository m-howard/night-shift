# Working in this repository

Conventions for anybody changing this code — human or agent. `eslint.config.mjs` enforces most of
what follows; this file exists for the reasoning behind the rules and for the ones a linter cannot
check.

Start with the three commands below, then Repository layout, then whichever section matches the
change you are making. If you are an agent, read the last section before you open anything.

## Toolchain

Bun is the only package manager. `bun.lock` is the only lockfile, and it is committed. Node and Bun
versions come from `.nvmrc` and `.bun-version`; the Pulumi CLI version is read from the
`@pulumi/pulumi` pin in `package.json`. The dev container reads all three at build time, so there
is exactly one place to bump each.

```bash
bun run lint && bun run lint:md
bun run typecheck
bun run test
```

Those three commands are what a reviewer runs. A change that does not pass them is not finished.

Nothing else runs them for you. The only workflow is CodeQL, and the pre-commit hook runs
`nano-staged`, which formats and lints the staged files and nothing more — no typecheck, no tests.
That is why the block above is a contract rather than a convenience.

## Repository layout

| Path                 | Holds                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `src/`               | The Pulumi stack — the AWS runner fleet. **Planned, not yet written.**       |
| `src/components/`    | Reusable Pulumi components, grouped by concern. One component per file.      |
| `tests/unit/`        | The default `bun run test`. No credentials, no network.                      |
| `tests/integration/` | Live-AWS suite, opt-in. Fails loudly when unconfigured.                      |
| `tests/helpers/`     | Test helpers. Covered by the coverage report, so they get tests too.         |
| `scripts/`           | Repository tooling. Executed directly, never imported by `src/`.             |
| `.devcontainer/`     | The dev image. Reads the version files — never pin a toolchain version here. |
| `.github/`           | CodeQL, Dependabot, CODEOWNERS, and the issue and pull request templates.    |
| `.husky/`            | Git hooks. One user hook: `pre-commit`, which runs `nano-staged`.            |

`src/` holds one file today — an empty placeholder. The stack lands there, not in a separate `infra/`
tree, so `eslint.config.mjs` scopes its infrastructure rules to `src/**`: 80-line functions, default
exports permitted, and `no-new` off for resource constructors used purely for their effect on the
graph. Those rules are already in place so the stack lands inside them rather than being retrofitted.
Do not invent a different location for it.

## File placement

- **Tests live under `tests/`**, split by what they are allowed to touch — never beside the code
  they test. `vitest.config.ts` globs `tests/unit/**` and `tests/integration/**` only, so a
  co-located `*.test.ts` silently never runs, which is the worst outcome available.
- **Scripts live under `scripts/`.** Every maintenance, debugging, generation or one-shot script
  goes there, whatever its extension. `scripts/**/*.ts` already has an ESLint override permitting
  `console` and default exports, because those files are executed rather than imported.
- **One exported concept per file.** If a file grows a second unrelated export, split it.
- **Group by feature, not by kind**, once there is enough code for the question to arise.

The repository root holds configuration and nothing else:

- Config — `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `.prettierrc`,
  `.markdownlint.jsonc`, `.editorconfig`
- Dependencies — `package.json`, `bun.lock`, `.npmrc`
- Documentation — `README.md`, `AGENTS.md`, `SECURITY.md`
- Ignores, CI and version pins — `.gitignore`, `.gitattributes`, `.prettierignore`,
  `.markdownlintignore`, `.nvmrc`, `.bun-version`, `.env.example`

Anything else belongs in a subdirectory. The root is the first thing a reader — or an agent loading
context — sees, and every file added to it costs everyone who arrives afterwards.

## Commands

| Command                    | What it does                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| `bun run test`             | Unit suite. Safe to run anywhere, on any machine.                   |
| `bun run test:watch`       | Unit suite in watch mode.                                           |
| `bun run test:coverage`    | Unit suite with V8 coverage.                                        |
| `bun run test:integration` | Live-AWS suite. Real credentials required.                          |
| `bun run typecheck`        | `tsc --noEmit` over `src`, `tests`, `scripts` and the root configs. |
| `bun run lint`             | ESLint, type-aware.                                                 |
| `bun run lint:fix`         | The same, writing fixes.                                            |
| `bun run lint:md`          | markdownlint over every Markdown file.                              |
| `bun run format`           | Prettier, writing in place.                                         |
| `bun run format:check`     | Prettier in check mode.                                             |
| `bun run clean`            | Removes build output; `--all` also drops `node_modules`.            |

Coverage is reported over `src/**` and `tests/helpers/**`. There is no threshold configured — the
number is information for a reviewer, not a gate, and this file will say so until one exists.

There is no build step. `tsc` is a checker: `noEmit` is on, `allowImportingTsExtensions` is on, and
Bun runs the TypeScript directly.

## Code clarity

- **No magic numbers.** `-1`, `0`, `1` and `2` read fine as literals; everything else gets a named
  constant explaining what the number _is_.
- **Bounded functions.** 50 lines and 3 parameters. Declarative resource wiring in `src/` gets 80
  lines, because splitting `createRunnerFleet` in half produces a function that exists only to
  satisfy a line count and a reader holding two names instead of one.
- **Bounded files.** 600 lines, blank lines and comments not counted. A file past that is holding
  more than one concept; find the seam and split there rather than at line 600.
- **No nested ternaries**, and `===` always.
- **Named exports** everywhere the rule applies. Default exports are permitted only where a
  framework demands them: the Pulumi stack in `src/`, and directly executed scripts and configs.
  Prefer a named export even there, and add the default alongside it rather than instead of it.
- **Imports are ordered**: built-ins, external packages, internal absolute, relative, then
  type-only, alphabetised with blank lines between groups. Relative imports carry their real `.ts`
  extension.
- **No `console`** outside `scripts/` and config files, where output is the interface.

Names: `camelCase` for variables and functions, `PascalCase` for types and classes,
`UPPER_SNAKE_CASE` for true constants, `kebab-case` for filenames. Booleans start with `is`, `has`,
`can` or `should`. A name that needs a comment to be understood is the wrong name.

Formatting is Prettier's job, not yours — single quotes, semicolons, two-space indent, 100
characters, trailing commas. Never hand-format around it.

Test files relax the magic-number and file-length rules on purpose. A table-driven test asserting on
forty literals is doing its job, and breaking it up to satisfy a line count makes it worse.

## Comments

Comment the _why_, never the _what_. A comment restating the line below it is noise that goes stale
independently of the code. The comments worth writing explain a decision a reader would otherwise
undo: why a pin exists, why a check is fail-closed, what breaks if the order changes. Only comment non-trivial code.

## Tests

Everything under `tests/`:

- `tests/unit/` — the default `bun run test`. No credentials, no network. Must pass on any machine.
- `tests/integration/` — runs against live AWS, opt-in via `bun run test:integration`. Read
  configuration at module scope so an unconfigured run fails during collection, before a test body
  has created anything in a real account. Timeouts are 60s, because real AWS calls are slow and
  rate-limited.
- `tests/helpers/` — helpers. Covered by the coverage report, so they carry tests of their own;
  `tests/helpers/env.ts` is the worked example.

These are two Vitest projects rather than one suite with skips, so that `bun run test` is
unconditionally safe and the integration project is free to fail hard the moment it is
misconfigured.

**If you change code under `src/`, tests land in the same pull request.** Not the next one.

## Infrastructure changes

The Pulumi stack under `src/` is the infrastructure this repository's own jobs run on, so a mistake
here takes CI down with it.

- Attach or summarise the `pulumi preview` output on the pull request. This is the human gate.
- Grant no permission wider than the work in front of it requires.
- State the cost impact.
- Record architectural decisions as an ADR that says what the decision **costs**, not only what it
  buys.

### Infrastructure organization

- **Reusability**: create modular components that can be reused across stacks.
- **Resource tagging**: apply a consistent tagging strategy for cost tracking and compliance. An
  untagged resource is one nobody can attribute a bill to.
- **Security first**: follow AWS security best practices in every component.
- **Documentation**: JSDoc every exported component — parameters, what it creates, and an example.
- **Testable logic**: keep pure logic (naming, policy construction, config validation) in its own
  module. It is the only part of a stack a unit test can reach without an engine.

### File structure patterns

One `ComponentResource` subclass per resource group, per file. Register outputs explicitly and
declare real dependencies with `dependsOn` rather than relying on inference.

```typescript
/**
 * AWS VPC Component - Creates and manages VPC infrastructure
 */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { type ComponentArgs } from './types.ts';

// Types and interfaces
interface VpcArgs extends ComponentArgs {
  cidrBlock: string;
  enableDnsHostnames?: boolean;
}

// Main component implementation
export class VpcComponent extends pulumi.ComponentResource {
  public readonly vpc: aws.ec2.Vpc;
  public readonly publicSubnets: aws.ec2.Subnet[];
  public readonly privateSubnets: aws.ec2.Subnet[];

  constructor(name: string, args: VpcArgs, opts?: pulumi.ComponentResourceOptions) {
    super('aws:networking:VpcComponent', name, {}, opts);

    // Implementation

    this.registerOutputs({
      vpc: this.vpc,
      publicSubnets: this.publicSubnets,
      privateSubnets: this.privateSubnets,
    });
  }
}

// Default export (if applicable)
export default VpcComponent;
```

## Documentation

Update the documentation in the pull request that changes the behaviour. A stale document is worse
than a missing one, because a reader trusts it.

- Document configuration exhaustively — every variable, its default, and what happens when it is
  absent. `.env.example` is the contract.
- Document non-obvious behaviour: edge cases, fail-closed checks, and anything a reader might
  reasonably try to simplify.
- Do not document what the type system already says.
- ADRs go in `docs/adr/` as `NNNN-kebab-title.md` with date, status, context, decision and
  consequences. The consequences section states the cost. That directory does not exist yet; the
  first ADR creates it.

Write for whoever maintains this in six months. Concrete examples over abstract description, one
idea per paragraph, consistent terminology, code blocks tagged with a language, and tables for
anything that is really a list of options.

## Git workflow

Conventional commits: `type(scope): subject`, where type is one of `feat`, `fix`, `refactor`,
`docs`, `test`, `chore`, `perf`, `style` or `ci`. Imperative mood, lowercase, no trailing period, 72
characters or fewer. The body explains why; wrap it at 80. Reference issues with `Closes #123`.

Nothing enforces this — there is no commitlint in this repository. It holds because people and
agents follow it, which is exactly why it is written down here.

- Branch from `main` with a `feature/`, `fix/`, `chore/`, `refactor/`, `docs/` or `ci/` prefix. Keep
  branches short-lived and delete them after merge.
- One logical change per pull request. Fill in the template — the test plan and the infrastructure
  section are read, not decoration.
- Squash-merge. Never force-push `main`.

Safety, in order of how much damage getting it wrong does:

- Never commit secrets, credentials or tokens. `.env` is git-ignored; `.env.example` carries names
  and never values.
- `bun.lock` is the only lockfile. A `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock` appearing
  in a diff is a bug in how the change was made, not a new option.
- Never commit generated output — `node_modules/`, `dist/`, `coverage/`, `.pulumi/`.
- Read `git diff --cached` before committing. Every time.

## Security

- Least privilege everywhere, and narrower for anything an agent can reach unattended.
- Untrusted pull request code never runs with access to secrets. `pull_request_target` is the
  specific trap; assume any workflow trigger you add is wrong until you have checked it against
  that.
- Credentials belong in no commit, log, issue report or pull request description.
- **Pin GitHub Actions to a full commit SHA of the latest release, with the version as a trailing
  comment** — `uses: actions/checkout@3d3c42e… # v7.0.1`. A tag is mutable, so a compromised
  upstream can repoint it at new code; the comment is what makes the pin readable, and Dependabot
  updates both together. Steps from the same action must share one SHA — `github/codeql-action`
  errors when `analyze` loads a config that `init` wrote on a different version.
- Report vulnerabilities privately through the advisory link in `SECURITY.md`, never a public issue.

## If you are an agent

You are the subject of this repository, not just a contributor to it. Two rules on top of the
above:

1. **Stay inside what policy already approves.** A change outside it is not yours to merge — open
   the pull request, classify the risk, and leave it for a human. Escalating is a successful
   outcome, not a failure.
2. **Link your source.** A dependency bump, a security fix, or a config change driven by a vendor
   release cites the release note, advisory, or post it came from. A reviewer at 9am needs to
   verify your reasoning without reconstructing your research.
