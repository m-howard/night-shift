---
agent: maintainer
tools: [read, search, execute, web, edit, 'github/*']
description: Check for outdated npm dependencies, assess upgrade risk, and create PRs for safe updates
---

Check for outdated npm dependencies in this `github-runners-eks` repository.

Optional scope: ${input:scope}

Use the **dependency-checker** skill to guide your analysis.

Read the change-assessment schema from `.agents/schemas/change-assessment.schema.json` and the dependency-report schema from `.agents/schemas/dependency-report.schema.json` before producing output.

## Workflow

1. Run `npm outdated --json` to gather raw dependency data.
2. Read `package.json` to understand dependency types and version ranges.
3. For each outdated package:
    - Determine the semver change type (patch, minor, major).
    - Check the changelog or release notes for breaking changes using the web tool.
    - Assess impact on this project (Pulumi provider? AWS SDK? Dev tool?).
    - Search the codebase for usage of any deprecated or changed APIs.
4. Score each finding with risk (0-4) and complexity (0-4).
5. Produce a summary table and detailed change-assessment JSON for each finding.
6. For findings where `auto_actionable === true`:
    - Create a branch `maintenance/dependency-update/<package-name>`.
    - Update `package.json`, run `npm install`.
    - Run quality gates: `npm run lint && npm run format && npm run build && npm run test`.
    - Open a PR using the maintenance template format.
7. For findings where `auto_actionable === false`:
    - Present the assessment with recommended next steps and any prerequisites.

If `scope` is provided, limit the check to packages matching that scope (e.g., `@pulumi/*`, `devDependencies`, or a specific package name).

When finished, provide:

- Summary table of all findings
- Change-assessment JSON for each finding
- List of PRs created (if any)
- List of items requiring human attention (if any)
