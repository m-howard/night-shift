---
name: cluster-version-checker
description: >
    Use this skill when the user wants to check EKS cluster Kubernetes version status, plan
    version upgrades, or assess end-of-support timelines. Trigger when the user says things
    like "check cluster version", "is EKS up to date", "Kubernetes upgrade", "EKS version",
    "end of support", "cluster upgrade plan", or when running periodic maintenance on the
    infrastructure. Also trigger when evaluating the impact of a Kubernetes version change
    on deployed workloads.
---

# Cluster Version Checker Skill

A structured skill for checking EKS cluster Kubernetes version status, evaluating upgrade paths, assessing workload impact, and producing actionable change assessments.

---

## Phase 1: Discover Current State

### Read Version from Project Configuration

Check the Pulumi configuration and stack outputs for the current EKS version:

```bash
# Search config files for EKS version
grep -r 'kubernetesVersion\|k8sVersion\|version.*1\.\d\+' src/config/ src/components/aws/eks/
```

```bash
# Check Pulumi stack outputs if available
pulumi stack output --stack moderna/gha-eks-runners-compute/dev --json 2>/dev/null | grep -i version
```

### Query Live Cluster (if AWS credentials are available)

```bash
# Get cluster name from config or known pattern
aws eks describe-cluster --name <cluster-name> --query 'cluster.{version:version,platformVersion:platformVersion,status:status}' --output json 2>/dev/null
```

If AWS credentials are expired, note this and work from the configuration files instead. Suggest running `./scripts/aws_login.sh dev` to enable live checks.

### Check AWS-Supported Versions

```bash
# List all supported EKS versions
aws eks describe-addon-versions --query 'addons[0].addonVersions[*].compatibilities[*].clusterVersion' --output json 2>/dev/null | sort -u
```

Or use the web tool to check:

- [Amazon EKS Kubernetes versions](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
- [Amazon EKS version calendar](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html#kubernetes-release-calendar)

Parse findings into the **cluster-version-report** schema (`.agents/schemas/cluster-version-report.schema.json`).

---

## Phase 2: Analyze Upgrade Path

### Version Gap Assessment

EKS supports sequential minor version upgrades only (e.g., 1.28 → 1.29 → 1.30, not 1.28 → 1.30).

Determine:

1. **How many minor versions behind?**
    - 0 versions behind: Current. No action needed.
    - 1 version behind: Standard. Plan upgrade at convenience.
    - 2+ versions behind: Urgent. End-of-support approaching.
2. **End-of-support date** for the current version (check AWS docs)
3. **Sequential upgrade path** — list each step (e.g., `["1.28", "1.29", "1.30"]`)

### Release Notes Review

For each version in the upgrade path, check:

- [EKS release notes](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
- [Kubernetes changelog](https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/)

Focus on:

- **Deprecated APIs** — any Kubernetes API versions removed in the target version?
- **Feature gates** — any features graduated or removed?
- **Admission webhook changes** — affects CRD-based controllers like ARC
- **Storage changes** — affects PVC/CSI behavior
- **Networking changes** — affects CNI (VPC CNI), NetworkPolicy, service mesh

---

## Phase 3: Assess Workload Impact

This project deploys specific workloads onto EKS. Evaluate each for upgrade compatibility:

### GitHub Actions Runner Controller (ARC)

- Check ARC compatibility matrix for the target Kubernetes version
- Review: `src/components/kubernetes/arc-controller/`
- Review: `src/components/kubernetes/arc-runner-scale-set/`
- ARC uses CRDs — verify CRD API versions are compatible

### CrowdStrike Falcon Sensor

- Check CrowdStrike Falcon operator compatibility with target K8s version
- Review: `src/components/kubernetes/crowdstrike/`
- DaemonSet-based — usually tolerant of K8s upgrades

### Dynatrace OneAgent

- Check Dynatrace operator compatibility with target K8s version
- Review: `src/components/kubernetes/dynatrace/`
- Operator-based — check operator version requirements

### Squid Proxy

- Review: `src/components/kubernetes/squid-proxy/`
- Standard Deployment — usually no K8s version constraints
- Check if NetworkPolicy API changes affect proxy rules

### Workload Identity (IRSA)

- Review: `src/components/kubernetes/workload-identity/`
- EKS IRSA is tightly coupled to EKS version — verify continued support
- Check if Pod Identity is available/preferred in the target version

### Namespace Bootstrap & Network Policies

- Review: `src/components/kubernetes/namespace-bootstrap/`
- Review: `src/components/kubernetes/runner-namespace-network-policies/`
- NetworkPolicy API compatibility with target version

### Pulumi Kubernetes Provider

- Verify `@pulumi/kubernetes` provider version supports the target K8s version
- Check if provider update is required as a prerequisite

---

## Phase 4: Produce Output

Generate a change assessment matching the **change-assessment** schema (`.agents/schemas/change-assessment.schema.json`).

### Risk Score (0-4)

| Scenario                                          | Risk                          |
| ------------------------------------------------- | ----------------------------- |
| Current version past end-of-support               | 0 (critical)                  |
| Current version within 3 months of end-of-support | 1 (high)                      |
| 2+ minor versions behind, deprecated APIs in use  | 1 (high)                      |
| 1 minor version behind, no deprecated APIs        | 2 (moderate)                  |
| 1 minor version behind, no workload impact        | 3 (low)                       |
| Running latest supported version                  | 4 (informational — no action) |

### Complexity Score (0-4)

| Scenario                                            | Complexity   |
| --------------------------------------------------- | ------------ |
| Single-step upgrade, no workload changes            | 1 (small)    |
| Single-step upgrade with minor workload adjustments | 2 (moderate) |
| Multi-step upgrade (2+ versions)                    | 3 (large)    |
| Multi-step upgrade with deprecated API migration    | 4 (epic)     |

### Output Format

```json
{
    "category": "cluster-upgrade",
    "title": "EKS cluster upgrade: <current> → <target>",
    "description": "...",
    "risk": 2,
    "complexity": 2,
    "current_state": {
        "cluster_name": "...",
        "current_version": "1.28",
        "latest_supported_version": "1.30",
        "end_of_support_date": "2025-11-01"
    },
    "recommended_action": "Upgrade EKS cluster sequentially: 1.28 → 1.29 → 1.30. Update Pulumi config, upgrade node groups, verify ARC and monitoring agents.",
    "affected_files": ["src/config/dev.ts", "src/config/prd.ts", "src/components/aws/eks/..."],
    "breaking_changes": false,
    "source_urls": ["https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html"],
    "auto_actionable": false
}
```

**Note**: Cluster upgrades are never `auto_actionable` — they always require human review and a deployment plan.

---

## Behavior Guidelines

- **Always check workload compatibility** — a K8s upgrade is not just a version number change
- **Sequential upgrades are mandatory** — never recommend skipping minor versions on EKS
- **Check the Pulumi provider first** — if `@pulumi/kubernetes` doesn't support the target version, that's a prerequisite
- **End-of-support dates drive urgency** — versions past EOL are security risks
- **Node group upgrades are separate** — note that control plane and node groups upgrade independently
- **Test in dev first** — always recommend upgrading the dev cluster before production
- **Consider add-ons** — EKS managed add-ons (CoreDNS, kube-proxy, VPC CNI) may need version bumps too
