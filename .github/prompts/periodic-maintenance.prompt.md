---
agent: maintainer
tools: [read, search, execute, web, edit, agent, 'github/*', 'beads/*']
description: Run all maintenance checks — security audit, dependency versions, cluster version, and external updates — then assess and action findings
---

Run a full periodic maintenance sweep on this `github-runners-eks` repository.

Use all four maintenance skills in order:

1. **security-auditor** — Run `npm audit`, triage vulnerabilities, fix what's auto-fixable
2. **dependency-checker** — Run `npm outdated`, assess upgrade risk for each package
3. **cluster-version-checker** — Check EKS version status and upgrade paths
4. **external-monitor** — Check blogs and releases for relevant updates

Read the change-assessment schema from `.agents/schemas/change-assessment.schema.json` before producing any output.

## Execution Order

Run checks in priority order (security first):

### Step 1: Security Audit

Run the security-auditor workflow. If auto-fixable vulnerabilities are found, fix them first — dependency checks in Step 2 will then run against the updated state.

### Step 2: Dependency Versions

Run the dependency-checker workflow. Cross-reference with Step 1 — if a dependency update was already applied as a security fix, don't duplicate it.

### Step 3: Cluster Version

Run the cluster-version-checker workflow. If AWS credentials are unavailable, skip this check and note it in the report.

### Step 4: External Updates

Run the external-monitor workflow. Cross-reference with Steps 1-3 — if an external update corresponds to a dependency or security finding already captured, link them rather than duplicating.

## Action Thresholds

After collecting all findings, apply this decision matrix:

| Risk | Complexity | Action                                                                  |
| ---- | ---------- | ----------------------------------------------------------------------- |
| 3-4  | 0-1        | **Auto-PR** — create branch, make changes, open PR                      |
| 0-2  | 0-1        | **Auto-PR + flag** — create PR but mark as needing careful human review |
| 0-2  | 2+         | **Report only** — too complex to auto-fix safely                        |
| any  | 3-4        | **Report only** — mark as epic candidate                                |

## PR Strategy

- Create **one PR per logical change** — not one giant PR with everything
- Group related changes (e.g., all `@aws-sdk/client-*` patch updates in one PR)
- Security fixes get their own PR, separate from version bumps
- Each PR must pass quality gates: `npm run lint && npm run format && npm run build && npm run test`

## Deduplication

Before creating assessments:

- If a dependency update also fixes a security vulnerability, create ONE assessment with category `security-audit` (higher priority)
- If an external release corresponds to an available dependency update, link the external source URL in the dependency assessment rather than creating a separate finding
- If cluster version upgrade requires a Pulumi provider update, note the dependency in both assessments and mark the provider update as a prerequisite

## Consolidated Report

When all checks are complete, produce a single summary report:

```markdown
## Periodic Maintenance Report

**Date**: <timestamp>
**Checks Completed**: security-audit, dependency-versions, cluster-version, external-updates
**Checks Skipped**: <any skipped and why>

### Findings by Category

| Category          | Total | Critical/High | Auto-Actionable | PRs Created |
| ----------------- | ----- | ------------- | --------------- | ----------- |
| security-audit    | ...   | ...           | ...             | ...         |
| dependency-update | ...   | ...           | ...             | ...         |
| cluster-upgrade   | ...   | ...           | ...             | ...         |
| feature-discovery | ...   | ...           | ...             | ...         |

### PRs Created

1. #NNN: <title> (risk: X, complexity: Y)
2. ...

### Items Requiring Human Attention

1. <title> — risk: X, complexity: Y — <why it needs human review>
2. ...

### Informational Items

- <brief summaries of low-priority / no-action findings>
```

Include all detailed change-assessment JSON objects after the summary.

When finished, confirm:

- Total number of findings
- Number of PRs created vs findings reported only
- Whether any checks were skipped
- Top priority items requiring human attention
