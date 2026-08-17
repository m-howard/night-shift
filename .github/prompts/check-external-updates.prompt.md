---
agent: maintainer
tools: [read, search, execute, web]
description: Monitor external blogs and releases for updates relevant to this project
---

Check external blogs and release feeds for updates relevant to this `github-runners-eks` project.

Optional timeframe: ${input:timeframe}
Optional source filter: ${input:source}

Use the **external-monitor** skill to guide your analysis.

Read the change-assessment schema from `.agents/schemas/change-assessment.schema.json` and the external-update-report schema from `.agents/schemas/external-update-report.schema.json` before producing output.

## Workflow

1. Check all monitored sources (or the specific `source` if provided):
    - **AWS EKS Blog**: https://aws.amazon.com/blogs/containers/
    - **GitHub Actions / ARC Releases**: via `gh api` for actions-runner-controller, runner
    - **Pulumi Releases**: via `gh api` for pulumi-aws, pulumi-kubernetes, pulumi-eks, pulumi
    - **GitHub Blog**: https://github.blog/changelog/
2. Filter for relevance to this project:
    - High: directly affects deployed components (EKS, ARC, Pulumi providers)
    - Medium: related technology or pattern
    - Low: tangentially related
3. Cross-reference findings with current versions in `package.json` and Pulumi config to check if we're already up to date.
4. For each relevant finding, determine if action is needed in the codebase.
5. Produce the external-update-report JSON with all findings.
6. For actionable findings, also produce change-assessment JSON.

Default timeframe is the last 30 days. If `timeframe` is provided (e.g., `7d`, `90d`, `2026-01-01`), use that instead.

Valid `source` values: `aws-eks-blog`, `github-actions-arc`, `pulumi-releases`, `github-blog`.

When finished, provide:

- Findings summary table (source, title, date, relevance, action needed)
- Detailed external-update-report JSON
- Change-assessment JSON for any actionable items
- Brief summary of informational items
