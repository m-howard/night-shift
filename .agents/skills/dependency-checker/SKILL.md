---
name: dependency-checker
description: >
    Use this skill when the user wants to check for outdated npm dependencies, assess upgrade risk,
    and plan dependency updates. Trigger when the user says things like "check dependencies",
    "are there any outdated packages", "update dependencies", "check for new versions",
    "what needs updating", or when running periodic maintenance on the project.
    Also trigger when a specific package update is being evaluated for risk and compatibility.
---

# Dependency Checker Skill

A structured skill for identifying outdated npm dependencies, assessing upgrade risk and complexity, and producing actionable change assessments.

---

## Phase 1: Gather Dependency Data

Run the following command to collect raw dependency state:

```bash
npm outdated --json 2>/dev/null || echo '{}'
```

Also read `package.json` to understand:

- Which packages are `dependencies` (production) vs `devDependencies`
- What version ranges are declared (exact, caret, tilde)
- Whether there are any `overrides` or `resolutions` in place

Parse the `npm outdated` output into findings matching the **dependency-report** schema (`.agents/schemas/dependency-report.schema.json`).

---

## Phase 2: Assess Each Outdated Package

For each outdated package, determine:

### Semver Change Type

- **Patch** (e.g., 3.1.0 → 3.1.2): Bug fixes only. Lowest risk.
- **Minor** (e.g., 3.1.0 → 3.2.0): New features, backward compatible. Low-moderate risk.
- **Major** (e.g., 3.1.0 → 4.0.0): Breaking changes possible. Highest risk.

### Impact Analysis

For each package, answer:

1. **Is it a direct or transitive dependency?** Direct deps are higher impact.
2. **Is it a Pulumi provider package?** (`@pulumi/aws`, `@pulumi/kubernetes`, `@pulumi/eks`, `@pulumi/aws-native`) — these directly affect deployed infrastructure and require careful upgrade planning.
3. **Is it an AWS SDK package?** (`@aws-sdk/client-*`) — check if the new version changes API behavior.
4. **Is it a dev-only tool?** (eslint, prettier, jest, typescript) — lower blast radius, usually safe.
5. **Are there breaking changes?** Check the package's changelog or release notes via the web tool.
6. **Does this project use APIs that changed?** Search the codebase for usage of deprecated or changed APIs.

### Sources to Check

- GitHub releases page: `https://github.com/<org>/<repo>/releases`
- npm page: `https://www.npmjs.com/package/<name>`
- Changelog: Usually `CHANGELOG.md` in the repo root
- For Pulumi packages: `https://www.pulumi.com/docs/iac/packages-and-automation/packages/` and the migration guide if a major version

---

## Phase 3: Score Risk and Complexity

Assign scores using the **change-assessment** schema definitions:

### Risk Score (0-4)

| Score | Criteria                                                | Examples                                                           |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | Critical — breaking production or security fix required | Pulumi provider major version with breaking resource schema        |
| 1     | High — significant regression risk, end-of-support      | Major version of `@pulumi/aws` with deprecated resources used here |
| 2     | Moderate — compatibility concerns, non-trivial testing  | Minor version of Pulumi provider with new resource behavior        |
| 3     | Low — minor version bump, well-tested upgrade path      | Patch/minor of eslint, prettier, jest                              |
| 4     | Informational — no urgency                              | Optional new dev tool version                                      |

### Complexity Score (0-4)

| Score | Criteria                                                | Examples                                                   |
| ----- | ------------------------------------------------------- | ---------------------------------------------------------- |
| 0     | Trivial — `npm update` or single version bump           | Patch update to a devDependency                            |
| 1     | Small — a few file edits, no architecture change        | Minor update with one deprecated API to replace            |
| 2     | Moderate — multiple components affected, testing needed | Major update to a Pulumi provider requiring config changes |
| 3     | Large — cross-stack changes, migration steps            | Major Pulumi SDK upgrade with Output API changes           |
| 4     | Epic — multi-sprint, architectural redesign             | Kubernetes API version migration across all components     |

### Auto-Actionable Criteria

Set `auto_actionable: true` when ALL of these are true:

- `risk >= 3` (low or informational)
- `complexity <= 1` (trivial or small)
- `breaking_changes === false`
- Package is a `devDependency` OR a patch update to a production dependency

---

## Phase 4: Produce Output

Generate one **change-assessment** (`.agents/schemas/change-assessment.schema.json`) per finding or per logical group:

- **Group patch updates** of the same type (e.g., all `@aws-sdk/client-*` patches) into a single assessment
- **Keep major updates separate** — one assessment per package for major bumps
- **Keep Pulumi provider updates separate** — always individual assessments due to infrastructure impact

### Output Format

Present findings in two sections:

#### Summary Table

| Package | Current | Latest | Change | Risk | Complexity | Auto-PR? |
| ------- | ------- | ------ | ------ | ---- | ---------- | -------- |
| ...     | ...     | ...    | ...    | ...  | ...        | ...      |

#### Detailed Assessments

For each assessment, output valid JSON matching the change-assessment schema, wrapped in a code block:

```json
{
    "category": "dependency-update",
    "title": "...",
    "description": "...",
    "risk": 3,
    "complexity": 0,
    "current_state": { "package": "...", "version": "..." },
    "recommended_action": "...",
    "affected_files": ["package.json"],
    "breaking_changes": false,
    "source_urls": ["..."],
    "auto_actionable": true
}
```

---

## Behavior Guidelines

- **Always check changelogs before scoring** — do not guess about breaking changes
- **Pulumi providers are high-impact** — always research these thoroughly, even for minor bumps
- **AWS SDK packages travel together** — if one `@aws-sdk/client-*` needs updating, check if others do too
- **devDependencies are lower risk but not zero** — a broken eslint config or TypeScript version can block CI
- **Respect lockfile** — note if `package-lock.json` drift could cause issues
- **Surface transitive dependency risks** — if a direct dep update pulls in a risky transitive change, flag it
