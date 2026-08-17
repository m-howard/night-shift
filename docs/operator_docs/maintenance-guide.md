# AI Maintenance Workflows

This guide covers the AI-powered maintenance system for the `github-runners-eks` repository. It explains how to invoke checks manually, understand risk and complexity scoring, review findings, and act on recommendations.

---

## Overview

The maintenance system uses GitHub Copilot agents invoked directly in VS Code. There are no scheduled jobs or GitHub Actions workflows — all checks are triggered manually when you choose to run them.

Four independent checks are available:

| Check               | Prompt                    | What It Does                                                    |
| ------------------- | ------------------------- | --------------------------------------------------------------- |
| Security audit      | `/check-security`         | Runs `npm audit`, triages CVEs by exploitability                |
| Dependency versions | `/check-dependencies`     | Runs `npm outdated`, assesses upgrade risk per package          |
| Cluster version     | `/check-cluster-version`  | Checks EKS Kubernetes version, upgrade paths, workload impact   |
| External updates    | `/check-external-updates` | Scans AWS/GitHub/Pulumi blogs and releases for relevant changes |

A fifth prompt runs all four in one sweep:

| Check                  | Prompt                  | What It Does                                             |
| ---------------------- | ----------------------- | -------------------------------------------------------- |
| Full maintenance sweep | `/periodic-maintenance` | Runs all four checks, deduplicates, and actions findings |

---

## How to Invoke

Open GitHub Copilot Chat in VS Code and use the `@maintainer` agent with a maintenance prompt.

### Run a single check

```
@maintainer /check-security
@maintainer /check-dependencies
@maintainer /check-cluster-version
@maintainer /check-external-updates
```

### Run the full sweep

```
@maintainer /periodic-maintenance
```

### Optional inputs

Each prompt accepts optional inputs to narrow its scope:

| Prompt                    | Input                                     | Example                           |
| ------------------------- | ----------------------------------------- | --------------------------------- |
| `/check-dependencies`     | `scope` — filter by package name or group | `@pulumi/*`, `devDependencies`    |
| `/check-security`         | `severity` — minimum severity to report   | `high`, `critical`                |
| `/check-cluster-version`  | `environment` — which cluster to check    | `dev`, `prd`                      |
| `/check-external-updates` | `timeframe` — how far back to look        | `7d`, `90d`, `2026-01-01`         |
| `/check-external-updates` | `source` — limit to one source            | `aws-eks-blog`, `pulumi-releases` |

---

## Risk and Complexity Scoring

Every finding is scored with two independent dimensions.

### Risk Score (0–4)

Aligned with `bd` task priority.

| Score | Label         | Description                                             | Examples                                                                      |
| ----- | ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0     | Critical      | Breaking production or active security vulnerability    | Critical CVE in a direct dep, EKS cluster past end-of-support                 |
| 1     | High          | Significant regression risk, approaching end-of-support | Major Pulumi provider bump with deprecated resources, EKS N-2 versions behind |
| 2     | Moderate      | Compatibility concerns, non-trivial testing needed      | Minor Pulumi provider bump with changed behavior, moderate CVE in dep         |
| 3     | Low           | Minor bump, well-tested path, low blast radius          | Patch devDependency update, low CVE with no viable exploit path               |
| 4     | Informational | No urgency, nice-to-have                                | New feature available in a provider we already use                            |

### Complexity Score (0–4)

| Score | Label    | Description                                    | Examples                                                     |
| ----- | -------- | ---------------------------------------------- | ------------------------------------------------------------ |
| 0     | Trivial  | Single command, no code changes                | `npm audit fix`, patch devDep bump                           |
| 1     | Small    | A few file edits, no architectural change      | Minor dep update with one deprecated API                     |
| 2     | Moderate | Multiple components affected, testing required | Pulumi provider config changes across stacks                 |
| 3     | Large    | Cross-stack changes, migration steps           | Multi-step EKS version upgrade, deprecated K8s API migration |
| 4     | Epic     | Multi-sprint, architectural redesign           | Pulumi SDK major version migration                           |

---

## What the Agent Does with Findings

### Auto-PR threshold

The agent creates a branch and opens a PR automatically when:

- Risk is 3 or 4 (low or informational)
- Complexity is 0 or 1 (trivial or small)
- No breaking changes

PRs with risk 0–2 that still meet the complexity threshold are created but flagged for careful human review before merging.

### Non-auto-actionable findings

When a finding does not meet the auto-PR threshold (typically risk 0–2 with complexity 2+, or complexity 3–4 regardless of risk), the agent produces a detailed assessment but does not make changes autonomously. You receive:

- Risk and complexity scores with justification
- Description of what needs to change and why
- Affected files
- Source URLs (release notes, advisories, migration guides)
- Recommended next steps

Act on these findings by opening a Jira issue in BTP and planning implementation using the standard workflow.

### PR structure

Auto-created PRs use the [maintenance PR template](.github/PULL_REQUEST_TEMPLATE/maintenance.md) and include:

- Category (security-audit, dependency-update, cluster-upgrade, feature-discovery)
- Risk and complexity scores with justification
- Full change-assessment JSON
- Test plan (lint, format, build, test results)
- Rollback plan
- Source URLs

---

## Structured Output (JSON Schema)

The agent produces machine-readable output for every finding. Schemas are in `.agents/schemas/`:

| Schema                               | Purpose                                    |
| ------------------------------------ | ------------------------------------------ |
| `change-assessment.schema.json`      | Universal finding output — one per finding |
| `dependency-report.schema.json`      | Raw `npm outdated` data                    |
| `security-audit-report.schema.json`  | Raw `npm audit` data                       |
| `cluster-version-report.schema.json` | EKS version and upgrade path data          |
| `external-update-report.schema.json` | Blog and release findings                  |

Every prompt instructs the agent to produce valid JSON conforming to `change-assessment.schema.json` for each finding, alongside the domain-specific raw report.

---

## Credential Requirements

| Check                    | Tool                       | Credentials Needed                    |
| ------------------------ | -------------------------- | ------------------------------------- |
| Security audit           | `npm audit`                | None — works offline                  |
| Dependency versions      | `npm outdated`             | None — works offline                  |
| Cluster version (live)   | `aws eks describe-cluster` | Valid AWS STS credentials             |
| Cluster version (config) | Pulumi config files        | None                                  |
| External updates         | `gh api`, web              | `gh` authenticated, network access    |
| PR creation              | `gh pr create`             | `gh` authenticated, repo write access |

If AWS credentials are expired, the agent reports this, skips the live cluster query, reads the version from Pulumi config instead, and suggests running:

```bash
./scripts/aws_login.sh dev
```

If `gh` is not authenticated:

```bash
gh auth login
```

---

## Monitoring Frequency Recommendation

There are no enforced schedules. As a rule of thumb:

| Check               | Suggested Cadence |
| ------------------- | ----------------- |
| Security audit      | Weekly            |
| Dependency versions | Bi-weekly         |
| Cluster version     | Monthly           |
| External updates    | Monthly           |
| Full sweep          | Monthly           |

---

## Agent and Skill Reference

The maintenance system is built from an agent, four skills, five prompts, and five JSON schemas.

```
.github/agents/maintainer.agent.md      ← coordinates all checks, creates PRs
.github/prompts/check-dependencies.prompt.md
.github/prompts/check-security.prompt.md
.github/prompts/check-cluster-version.prompt.md
.github/prompts/check-external-updates.prompt.md
.github/prompts/periodic-maintenance.prompt.md

.agents/skills/dependency-checker/SKILL.md
.agents/skills/security-auditor/SKILL.md
.agents/skills/cluster-version-checker/SKILL.md
.agents/skills/external-monitor/SKILL.md

.agents/schemas/change-assessment.schema.json
.agents/schemas/dependency-report.schema.json
.agents/schemas/security-audit-report.schema.json
.agents/schemas/cluster-version-report.schema.json
.agents/schemas/external-update-report.schema.json
```
