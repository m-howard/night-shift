---
agent: maintainer
tools: [read, search, execute, web, edit, 'github/*']
description: Run npm audit, triage vulnerabilities by exploitability and remediation effort, and fix what can be fixed
---

Run a security audit on npm dependencies in this `github-runners-eks` repository.

Optional severity filter: ${input:severity}

Use the **security-auditor** skill to guide your analysis.

Read the change-assessment schema from `.agents/schemas/change-assessment.schema.json` and the security-audit-report schema from `.agents/schemas/security-audit-report.schema.json` before producing output.

## Workflow

1. Run `npm audit --json` to gather raw vulnerability data.
2. Run `npm audit fix --dry-run --json` to identify auto-fixable issues.
3. For each vulnerability:
    - Determine if it's in a direct or transitive dependency.
    - Check if the vulnerable code path is actually used in this project.
    - Assess exploitability in context (this is a Pulumi IaC project, not a web server).
    - Check if a patched version is available.
4. Score each finding with risk (0-4) and complexity (0-4).
5. Produce a summary table and detailed change-assessment JSON for each finding.
6. For auto-fixable issues (all criteria met: `npm audit fix` resolves, no breaking changes, patch/minor only):
    - Run `npm audit fix`.
    - Run quality gates: `npm run lint && npm run format && npm run build && npm run test`.
    - Create a branch `maintenance/security-audit/batch-fix` and open a PR.
7. For manual fixes:
    - Present the assessment with a remediation plan.
    - Note any prerequisite dependency updates needed.
8. For no-fix-available vulnerabilities:
    - Document the vulnerability and its practical risk in this context.
    - Recommend monitoring or dependency replacement if critical.

If `severity` is provided, limit the report to findings at or above that severity level (e.g., `high`, `critical`).

When finished, provide:

- Summary table of all findings
- Change-assessment JSON for each finding
- List of PRs created (if any)
- List of items requiring human attention (if any)
- Count of vulnerabilities by severity
