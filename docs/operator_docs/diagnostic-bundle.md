# Diagnostic Bundle Checklist

> **Requirements:** REQ-DOC-004, REQ-DOC-061
>
> **Task:** `github-runners-eks-6pj` (Epic 7, Task 7.6)

This checklist defines the minimum evidence required when raising a support ticket or incident report for the GitHub EKS Runner platform. Incomplete bundles will be returned to the submitter. For the debugging commands behind each item, see the [Kubectl Debugging Runbook](kubectl-runbook.md).

---

## Table of Contents

1. [Mandatory Evidence Items](#mandatory-evidence-items)
2. [Quick Capture Commands](#quick-capture-commands)
3. [Evidence File Naming](#evidence-file-naming)
4. [Submitting the Bundle](#submitting-the-bundle)

---

## Mandatory Evidence Items

Complete ALL items below before submitting. Mark each item ✅ when captured.

### Identification

| #   | Item                                   | Source                                                       |
| --- | -------------------------------------- | ------------------------------------------------------------ |
| 1   | GitHub Actions **run ID**              | GitHub UI → run URL, or `GITHUB_RUN_ID` in job logs          |
| 2   | **Runner label(s)** used in `runs-on`  | Workflow YAML                                                |
| 3   | **Timestamp** of the failure (UTC)     | GitHub Actions job log header                                |
| 4   | **Environment** (`dev` / `prd`)        | Known from the cluster name                                  |
| 5   | **Namespace** where the issue occurred | e.g. `arc-runners`, `arc-build-runners`, `arc-coding-agents` |

### GitHub & Cluster Evidence

| #   | Item                                                   | Command                                                           |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| 6   | **Job log** (full, from GitHub Actions UI)             | Download from GitHub → Actions → run → job → download logs        |
| 7   | **Error signature** — exact error message or exit code | Copied from job log output                                        |
| 8   | **Pod name** for the runner pod                        | `kubectl get pods -n <namespace>`                                 |
| 9   | **Pod description** (`kubectl describe`)               | See [Quick Capture Commands](#quick-capture-commands)             |
| 10  | **Container logs** — current instance                  | `kubectl logs <pod> -n <namespace>`                               |
| 11  | **Container logs** — previous instance (if restarted)  | `kubectl logs <pod> -n <namespace> --previous`                    |
| 12  | **Namespace events** (Warning type)                    | `kubectl get events -n <namespace> --field-selector=type=Warning` |

### Alarm Context (when incident is alarm-driven)

| #   | Item                                                | Source                                    |
| --- | --------------------------------------------------- | ----------------------------------------- |
| 13  | **Alarm name** that fired                           | AWS Console → CloudWatch → Alarms         |
| 14  | **Alarm state history** (screenshot or JSON export) | CloudWatch → Alarms → alarm → History tab |
| 15  | **Metric data** for the alarm period                | CloudWatch → Metrics → Container Insights |

### Remediation

| #   | Item                    | Notes                                                                    |
| --- | ----------------------- | ------------------------------------------------------------------------ |
| 16  | **Remediation applied** | Free-text: describe the exact action taken and when                      |
| 17  | **Verification output** | `kubectl get pods -n <namespace>` showing healthy state post-remediation |

---

## Quick Capture Commands

Run the following to collect the core cluster evidence in one step. Replace `<NAMESPACE>` and `<POD>` with the affected values.

```bash
#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="<NAMESPACE>"
POD="<POD>"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BUNDLE_DIR="diagnostic-bundle-${TIMESTAMP}"

mkdir -p "${BUNDLE_DIR}"

# Kubeconfig — retrieve before running any kubectl commands
# eksctl utils write-kubeconfig --cluster github-runners-eks-<env> --region us-east-1

echo "Collecting pod description..."
kubectl describe pod "${POD}" -n "${NAMESPACE}" \
  > "${BUNDLE_DIR}/pod-describe.txt"

echo "Collecting current container logs..."
kubectl logs "${POD}" -n "${NAMESPACE}" \
  > "${BUNDLE_DIR}/pod-logs-current.txt" || true

echo "Collecting previous container logs..."
kubectl logs "${POD}" -n "${NAMESPACE}" --previous \
  > "${BUNDLE_DIR}/pod-logs-previous.txt" 2>&1 || true

echo "Collecting namespace events..."
kubectl get events -n "${NAMESPACE}" \
  --field-selector=type=Warning \
  --sort-by='.lastTimestamp' \
  > "${BUNDLE_DIR}/namespace-events-warning.txt"

echo "Collecting all namespace pod status..."
kubectl get pods -n "${NAMESPACE}" -o wide \
  > "${BUNDLE_DIR}/namespace-pods.txt"

echo "Collecting node status..."
kubectl get nodes -o wide \
  > "${BUNDLE_DIR}/nodes.txt"

echo "Collecting ARC AutoscalingRunnerSet status..."
kubectl get autoscalingrunnerset -A \
  > "${BUNDLE_DIR}/arc-autoscaling-runner-sets.txt" 2>/dev/null || true

echo "Collecting deployment status..."
kubectl get deployments -A \
  | grep -E 'arc-system|arc-runners|arc-build-runners|arc-coding-agents|egress-proxy' \
  > "${BUNDLE_DIR}/deployments.txt" || true

echo ""
echo "Bundle collected in: ${BUNDLE_DIR}/"
ls -lh "${BUNDLE_DIR}/"
```

Save this script as `collect-diagnostics.sh`, make it executable (`chmod +x collect-diagnostics.sh`), and run it from within the repository root after retrieving a fresh kubeconfig.

---

## Evidence File Naming

Use UTC timestamps and descriptive names to avoid confusion when multiple captures exist for the same incident.

| Pattern                              | Example                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `diagnostic-bundle-<UTC>/<file>.txt` | `diagnostic-bundle-20260323T143000Z/pod-describe.txt` |
| `alarm-screenshot-<UTC>.png`         | `alarm-screenshot-20260323T143000Z.png`               |

---

## Submitting the Bundle

1. **Create a support ticket** addressed to `btp@modernatx.com` with subject: `[GitHub Runners EKS] Incident — <brief description>`.
2. **Attach the bundle directory** as a ZIP archive:

    ```bash
    zip -r "diagnostic-bundle-${TIMESTAMP}.zip" "${BUNDLE_DIR}/"
    ```

3. **Include in the ticket body:**
    - GitHub Actions run URL
    - Runner label used
    - UTC timestamp of the failure
    - Error signature (copy-pasted, not a screenshot)
    - Remediation attempted (if any)
4. If the incident is alarm-driven, attach the CloudWatch alarm state history export.

> Tickets missing mandatory evidence items 1–12 will be returned for completion before investigation begins.
