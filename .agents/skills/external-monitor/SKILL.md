---
name: external-monitor
description: >
    Use this skill when the user wants to check for new releases, blog posts, or announcements
    from external sources relevant to this project. Trigger when the user says things like
    "check for updates", "any new releases", "what's new in EKS", "check blogs",
    "monitor external sources", "new features available", or when running periodic maintenance.
    Sources: AWS EKS blog, GitHub Actions/ARC releases, Pulumi releases, GitHub blog.
---

# External Monitor Skill

A structured skill for checking external blogs, release feeds, and announcements for updates relevant to the github-runners-eks project.

---

## Monitored Sources

### 1. AWS EKS Blog & Release Notes

- **Blog**: https://aws.amazon.com/blogs/containers/
- **EKS Release Notes**: https://docs.aws.amazon.com/eks/latest/userguide/doc-history.html
- **What to look for**: New EKS features, Kubernetes version support changes, VPC CNI updates, EKS add-on changes, pricing changes, new instance types for node groups
- **Relevance filter**: Must relate to EKS, container networking, IAM roles for service accounts (IRSA), Pod Identity, or managed node groups

### 2. GitHub Actions / ARC Releases

- **ARC Releases**: `gh api repos/actions/actions-runner-controller/releases?per_page=10`
- **ARC Runner Images**: `gh api repos/actions/runner/releases?per_page=5`
- **GitHub Actions Blog**: https://github.blog/changelog/label/actions/
- **What to look for**: New ARC versions, runner image updates, runner scale set changes, webhook improvements, new runner features, deprecation notices
- **Relevance filter**: Must relate to actions-runner-controller, self-hosted runners, runner scale sets, or runner images used by this project

### 3. Pulumi Releases

- **Pulumi AWS Provider**: `gh api repos/pulumi/pulumi-aws/releases?per_page=5`
- **Pulumi Kubernetes Provider**: `gh api repos/pulumi/pulumi-kubernetes/releases?per_page=5`
- **Pulumi EKS Component**: `gh api repos/pulumi/pulumi-eks/releases?per_page=5`
- **Pulumi AWS Native Provider**: `gh api repos/pulumi/pulumi-aws-native/releases?per_page=5`
- **Pulumi Core SDK**: `gh api repos/pulumi/pulumi/releases?per_page=5`
- **Pulumi Blog**: https://www.pulumi.com/blog/
- **What to look for**: New provider versions, breaking changes, new resource support, SDK improvements, deprecation notices, migration guides
- **Relevance filter**: Must relate to AWS, Kubernetes, or EKS providers used by this project, or core SDK features used in the codebase

### 4. GitHub Blog

- **URL**: https://github.blog/
- **Changelog**: https://github.blog/changelog/
- **What to look for**: GitHub Copilot updates, GitHub Actions platform changes, GitHub API changes, new features affecting developer workflows
- **Relevance filter**: Must relate to GitHub Actions, Copilot (agents, coding agent), self-hosted runners, or developer experience features used by this team

---

## Phase 1: Fetch Latest Updates

### For GitHub-Hosted Sources (use `gh api`)

```bash
# ARC releases
gh api repos/actions/actions-runner-controller/releases?per_page=10 --jq '.[].{tag_name,name,published_at,html_url}' 2>/dev/null

# Runner releases
gh api repos/actions/runner/releases?per_page=5 --jq '.[].{tag_name,name,published_at,html_url}' 2>/dev/null

# Pulumi AWS provider
gh api repos/pulumi/pulumi-aws/releases?per_page=5 --jq '.[].{tag_name,name,published_at,html_url}' 2>/dev/null

# Pulumi Kubernetes provider
gh api repos/pulumi/pulumi-kubernetes/releases?per_page=5 --jq '.[].{tag_name,name,published_at,html_url}' 2>/dev/null

# Pulumi EKS component
gh api repos/pulumi/pulumi-eks/releases?per_page=5 --jq '.[].{tag_name,name,published_at,html_url}' 2>/dev/null

# Pulumi core SDK
gh api repos/pulumi/pulumi/releases?per_page=5 --jq '.[].{tag_name,name,published_at,html_url}' 2>/dev/null
```

### For Blog Sources (use web tool)

Use the web browsing tool to check:

1. **AWS Containers Blog** — scan recent posts for EKS-relevant content
2. **GitHub Blog Changelog** — scan for Actions and Copilot updates
3. **Pulumi Blog** — scan for provider and SDK updates

### Timeframe

Focus on content published within the last 30 days by default. If the user specifies a different timeframe, use that instead.

---

## Phase 2: Filter for Relevance

Not every release or blog post matters to this project. Apply these filters:

### High Relevance (always report)

- New ARC version with breaking changes or security fixes
- EKS Kubernetes version support changes (new versions added, versions deprecated)
- Pulumi provider versions that fix bugs encountered in this project
- Security advisories for any tool in the stack
- Deprecation notices for APIs, features, or tools used by this project
- GitHub Actions platform changes affecting self-hosted runners

### Medium Relevance (report if notable)

- New ARC features that could improve runner performance or reliability
- New Pulumi provider features for resources used in this project
- AWS service improvements for EKS, ECR, IAM, S3 (services used here)
- GitHub Copilot updates relevant to the agent/skill system used here
- New best practices or architectural patterns for EKS workloads

### Low Relevance (mention briefly or skip)

- General AWS blog posts not specific to EKS or containers
- Pulumi updates for providers not used here (Azure, GCP, etc.)
- GitHub features for repos, packages, or other non-Actions products
- Upstream Kubernetes changes not yet adopted by EKS

---

## Phase 3: Assess Actionability

For each relevant finding, determine:

1. **Does this require a change in our codebase?** (version bump, config change, new feature adoption)
2. **Is it informational only?** (good to know, no action needed)
3. **Is it a prerequisite for planned work?** (e.g., new provider version enables a feature we want)
4. **Does it change our risk posture?** (deprecation timeline, security advisory)

---

## Phase 4: Produce Output

Generate findings matching the **external-update-report** schema (`.agents/schemas/external-update-report.schema.json`).

For findings that require action, also produce a **change-assessment** (`.agents/schemas/change-assessment.schema.json`).

### Output Format

#### Findings Summary

| Source | Title | Published | Relevance | Action Needed? |
| ------ | ----- | --------- | --------- | -------------- |
| ...    | ...   | ...       | ...       | ...            |

#### Actionable Items

For each finding that requires a change, produce a change assessment:

```json
{
    "category": "feature-discovery",
    "title": "ARC v0.10.0 available with runner group support",
    "description": "...",
    "risk": 3,
    "complexity": 1,
    "current_state": { "arc_version": "0.9.3" },
    "recommended_action": "Update ARC Helm chart version in src/components/kubernetes/arc-controller/",
    "affected_files": ["src/components/kubernetes/arc-controller/..."],
    "breaking_changes": false,
    "source_urls": ["https://github.com/actions/actions-runner-controller/releases/tag/v0.10.0"],
    "auto_actionable": true
}
```

#### Informational Items

For findings that are good to know but don't require action, include a brief summary with the source URL and a note on when it might become relevant.

---

## Behavior Guidelines

- **Recency matters** — prioritize the most recent findings; older posts are less likely to be actionable
- **Don't flood with noise** — if there are many low-relevance findings, summarize them in a single paragraph rather than listing each one
- **Cross-reference with current versions** — compare release versions against what's in `package.json` and Pulumi config to identify if we're already up to date
- **Flag deprecation timelines** — if something we depend on has a deprecation date, calculate how much time remains
- **Watch for breaking change announcements** — even if the breaking change is in a future version, flag it early so the team can plan
- **Link to migration guides** — when a finding involves an upgrade, include the link to any official migration guide
