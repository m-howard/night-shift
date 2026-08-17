---
agent: maintainer
tools: [read, search, execute, web]
description: Check EKS cluster Kubernetes version status and assess upgrade paths
---

Check the EKS cluster Kubernetes version status for this `github-runners-eks` project.

Optional environment: ${input:environment}

Use the **cluster-version-checker** skill to guide your analysis.

Read the change-assessment schema from `.agents/schemas/change-assessment.schema.json` and the cluster-version-report schema from `.agents/schemas/cluster-version-report.schema.json` before producing output.

## Workflow

1. Determine the current EKS Kubernetes version:
    - Search `src/config/` and `src/components/aws/eks/` for the configured version.
    - If AWS credentials are available, query the live cluster: `aws eks describe-cluster`.
    - If credentials are expired, note this and work from config files.
2. Check the latest supported EKS version:
    - Use the web tool to check: https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html
    - Or run: `aws eks describe-addon-versions` to get supported versions.
3. Determine the upgrade path (sequential minor versions only on EKS).
4. Check end-of-support dates for the current version.
5. Assess workload impact by reviewing:
    - ARC controller and runner scale sets
    - CrowdStrike Falcon sensor
    - Dynatrace OneAgent operator
    - Squid proxy
    - Workload Identity (IRSA)
    - Network policies
    - Pulumi Kubernetes provider compatibility
6. Check Kubernetes release notes for deprecated APIs in the upgrade path.
7. Score the finding with risk (0-4) and complexity (0-4).
8. Produce the cluster-version-report JSON and a change-assessment JSON.

If `environment` is provided (e.g., `dev`, `prd`), check that specific environment's cluster. Otherwise, check the dev environment.

**Note**: Cluster upgrades are never auto-actionable — they always require human planning and approval.

When finished, provide:

- Current version and latest supported version
- Upgrade path (if applicable)
- End-of-support timeline
- Workload compatibility assessment
- Change-assessment JSON with risk and complexity scores
- Recommended next steps
