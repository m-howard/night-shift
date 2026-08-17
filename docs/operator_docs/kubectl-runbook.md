# Kubectl Debugging Runbook

> **Requirements:** REQ-DOC-001, REQ-DOC-003, REQ-DOC-004
>
> **Task:** `github-runners-eks-6pj` (Epic 7, Task 7.6)

This runbook standardises cluster debugging for operators. It covers kubeconfig retrieval, core investigation commands, alarm-to-runbook mappings, and minimum evidence capture expectations.

---

## Table of Contents

1. [Kubeconfig Retrieval](#kubeconfig-retrieval)
2. [Alarm-to-Runbook Mappings](#alarm-to-runbook-mappings)
3. [Core Investigation Commands](#core-investigation-commands)
4. [ARC Controller & Runner Debugging](#arc-controller--runner-debugging)
5. [Egress Proxy Debugging](#egress-proxy-debugging)
6. [Evidence Capture Expectations](#evidence-capture-expectations)

---

## Kubeconfig Retrieval

**Always retrieve a fresh kubeconfig before any kubectl operations.** The cluster API endpoint is private; you must be connected to the VPN or corporate network and have valid AWS credentials for the target account.

```bash
# Development cluster
eksctl utils write-kubeconfig \
  --cluster github-runners-eks-dev \
  --region us-east-1

# Production cluster
eksctl utils write-kubeconfig \
  --cluster github-runners-eks-prd \
  --region us-east-1
```

Verify connectivity:

```bash
kubectl cluster-info
kubectl get nodes
```

> If `kubectl cluster-info` times out, confirm VPN connectivity and that your AWS credentials have the `eks:DescribeCluster` permission on the target cluster. The IAM role for cluster admin access in dev is documented in `src/config/dev.ts` (`clusterAdminRoleArn`).

---

## Alarm-to-Runbook Mappings

The platform deploys three CloudWatch alarms via the `Observability` component. When an alarm fires, follow the corresponding section below for the initial investigation sequence.

| Alarm name (suffix)               | Trigger condition                                                         | Starting section                                        |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `observability-pod-failure-count` | Runner pod restarts ≥ 5 over two consecutive 5-minute periods             | [Pod Failure Investigation](#pod-failure-investigation) |
| `observability-pending-pod-count` | Pending / stalled pods — running pod count drops below expected threshold | [Pending Pod Investigation](#pending-pod-investigation) |
| `observability-failed-node-count` | Failed cluster node count ≥ 1 over two consecutive 5-minute periods       | [Failed Node Investigation](#failed-node-investigation) |

The full alarm ARN list is available in the `svc-compute` stack outputs:

```bash
pulumi -C /workspaces/github-runners-eks stack output --stack svc-compute --json \
  | jq '.observabilityAlarmNames, .observabilityAlarmArns'
```

### Pod Failure Investigation

Triggered by: `observability-pod-failure-count`

1. Identify the restarting pods across all runner namespaces:

    ```bash
    kubectl get pods -A --field-selector=status.phase!=Running \
      | grep -E 'arc-runners|arc-build-runners|arc-coding-agents|arc-system'
    ```

2. Check restart counts and last state:

    ```bash
    kubectl describe pod <pod-name> -n <namespace>
    ```

3. Pull the current and previous container logs:

    ```bash
    kubectl logs <pod-name> -n <namespace> --previous
    kubectl logs <pod-name> -n <namespace>
    ```

4. Check events for the namespace:

    ```bash
    kubectl get events -n <namespace> --sort-by='.lastTimestamp'
    ```

5. Remediation checklist:
    - OOMKilled → increase memory limits in the runner class config and redeploy
    - CrashLoopBackOff on ARC runner → check the `arc-github-auth` secret is present and has all required keys (`github_app_id`, `github_app_installation_id`, `github_app_private_key`)
    - Image pull error → verify ECR permissions and that the runner image tag is valid
    - Liveness/readiness probe failure → check resource contention and node capacity

---

### Pending Pod Investigation

Triggered by: `observability-pending-pod-count`

1. List pending pods with their reason:

    ```bash
    kubectl get pods -A --field-selector=status.phase=Pending
    ```

2. Describe the pending pod to see scheduling events:

    ```bash
    kubectl describe pod <pod-name> -n <namespace>
    ```

    Look for `FailedScheduling` events — common causes are:
    - Insufficient CPU or memory (`Insufficient cpu`, `Insufficient memory`)
    - Node selector not matching available nodes (`didn't match node selector`)
    - Taint/toleration mismatch
    - PodSecurityAdmission violation

3. Check node capacity and allocations:

    ```bash
    kubectl describe nodes | grep -A5 'Allocated resources'
    kubectl get nodes -o custom-columns='NAME:.metadata.name,STATUS:.status.conditions[-1].type,CPU:.status.capacity.cpu,MEM:.status.capacity.memory'
    ```

4. Remediation checklist:
    - Resource pressure → EKS Auto Mode should provision additional nodes; wait 2–3 minutes and recheck
    - PodSecurityAdmission violation → confirm runner pods meet the `baseline` PSA profile (no `hostPath` mounts, no privilege escalation)
    - Persistent pending after Auto Mode scale-out → check the `arc-system` namespace for ARC controller errors

---

### Failed Node Investigation

Triggered by: `observability-failed-node-count`

1. List nodes and their status:

    ```bash
    kubectl get nodes -o wide
    ```

2. Describe failing nodes for condition detail:

    ```bash
    kubectl describe node <node-name>
    ```

    Look for:
    - `NotReady` conditions
    - `MemoryPressure`, `DiskPressure`, or `PIDPressure` conditions
    - Eviction events

3. Check recent node events:

    ```bash
    kubectl get events -A --field-selector=reason=NodeNotReady \
      --sort-by='.lastTimestamp' | tail -20
    ```

4. Remediation checklist:
    - Auto Mode node failure → EKS Auto Mode should automatically replace the node; wait 5–10 minutes
    - Persistent NotReady → cordon the node and drain workloads:

        ```bash
        kubectl cordon <node-name>
        kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
        ```

    - Multiple simultaneous node failures → escalate to the platform team; check AWS CloudTrail and EC2 console for capacity or quota events

---

## Core Investigation Commands

### Pods

```bash
# All pods across platform namespaces
kubectl get pods -n arc-system
kubectl get pods -n arc-runners
kubectl get pods -n arc-runners-arm64
kubectl get pods -n arc-build-runners
kubectl get pods -n arc-build-runners-arm64
kubectl get pods -n arc-coding-agents
kubectl get pods -n egress-proxy

# Pods not in Running or Completed state (all namespaces)
kubectl get pods -A | grep -v -E '(Running|Completed|Terminating)'

# Pod details including probe status and last restart
kubectl describe pod <pod-name> -n <namespace>
```

### Logs

```bash
# Current logs (last 200 lines)
kubectl logs <pod-name> -n <namespace> --tail=200

# Previous container instance (after a restart)
kubectl logs <pod-name> -n <namespace> --previous

# Follow logs in real time
kubectl logs <pod-name> -n <namespace> -f

# All pods in a deployment
kubectl logs deployment/<deployment-name> -n <namespace> --tail=100
```

### Events

```bash
# All events in a namespace, most recent last
kubectl get events -n <namespace> --sort-by='.lastTimestamp'

# Warning events only
kubectl get events -n <namespace> --field-selector=type=Warning \
  --sort-by='.lastTimestamp'

# Cluster-wide events
kubectl get events -A --sort-by='.lastTimestamp' | tail -40
```

### Deployments and ReplicaSets

```bash
# Deployment rollout status
kubectl rollout status deployment/<deployment-name> -n <namespace>

# Deployment details with condition history
kubectl describe deployment <deployment-name> -n <namespace>

# ReplicaSet status (shows desired/ready/available)
kubectl get rs -n <namespace>

# All deployments across platform namespaces
kubectl get deployments -A \
  | grep -E 'arc-system|arc-runners|arc-build-runners|arc-coding-agents|egress-proxy'
```

### Namespaces

```bash
# List all platform namespaces and their PSA labels
kubectl get namespaces \
  arc-system arc-runners arc-runners-arm64 \
  arc-build-runners arc-build-runners-arm64 \
  arc-coding-agents egress-proxy \
  -o custom-columns='NAME:.metadata.name,PSA-ENFORCE:.metadata.labels.pod-security\.kubernetes\.io/enforce'

# Namespace resource quotas and limits (if configured)
kubectl describe namespace <namespace>
```

---

## ARC Controller & Runner Debugging

### ARC Controller Health

The ARC controller is deployed in the `arc-system` namespace by the `arc-controller` Helm release.

```bash
# Controller pods
kubectl get pods -n arc-system -l app.kubernetes.io/part-of=gha-rs-controller

# Controller logs
kubectl logs -n arc-system deployment/arc-controller-gha-rs-controller --tail=200

# AutoscalingRunnerSet resources (one per runner class)
kubectl get autoscalingrunnerset -A
kubectl describe autoscalingrunnerset <name> -n <namespace>

# EphemeralRunner resources (active job pods)
kubectl get ephemeralrunner -A
```

### ARC Auth Secret

The `arc-github-auth` secret must exist in every runner namespace and in `arc-system`.

```bash
# Verify secret presence (do NOT print values)
for ns in arc-system arc-runners arc-runners-arm64 arc-build-runners arc-build-runners-arm64 arc-coding-agents; do
  echo "=== $ns ==="
  kubectl get secret arc-github-auth -n $ns -o jsonpath='{.data}' | jq 'keys'
done
```

Expected keys: `github_app_id`, `github_app_installation_id`, `github_app_private_key`.

If a key is missing, the `ArcAuthSecretSync` component failed to materialise the secret from AWS Secrets Manager. Re-run the `svc-compute` deploy or manually trigger a Pulumi refresh:

```bash
npm run deploy -- <env> --scope compute
```

### Network Policies

```bash
# List network policies per runner namespace
kubectl get networkpolicy -n arc-runners
kubectl get networkpolicy -n arc-build-runners

# Describe a policy for egress rule details
kubectl describe networkpolicy allow-egress-proxy-egress -n arc-runners

# For non-proxied namespaces, check the direct egress rule instead
kubectl describe networkpolicy allow-direct-internet-egress -n <non-proxied-namespace>
```

---

## Egress Proxy Debugging

The Squid proxy is deployed in the `egress-proxy` namespace. Not all runner namespaces use the proxy — check the runner class config first:

```bash
# Determine if a runner class uses the proxy
# If the runner class has egressProxy.enabled: false, skip proxy debugging and
# verify that allow-direct-internet-egress NetworkPolicy exists instead.
kubectl get networkpolicy -n <runner-namespace> | grep -E 'proxy|direct'
# Proxy pod status
kubectl get pods -n egress-proxy

# Proxy logs (includes CONNECT/request activity)
kubectl logs -n egress-proxy deployment/squid-proxy --tail=200

# Check the Squid config in use
kubectl get configmap squid-conf -n egress-proxy -o yaml

# Verify the proxy service endpoint
kubectl get svc squid-proxy -n egress-proxy
```

For proxy-related job failures, see the [Networking & Proxy Guide](../user_docs/networking-proxy-guide.md).

---

## Evidence Capture Expectations

All incident investigations **must** produce a diagnostic bundle before the incident is closed or escalated. See [diagnostic-bundle.md](diagnostic-bundle.md) for the full checklist and capture commands.

At minimum, every incident record must include:

| Evidence item                       | Command                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| Pod descriptions for affected pods  | `kubectl describe pod <pod> -n <ns>`                                |
| Container logs (current + previous) | `kubectl logs <pod> -n <ns> [--previous]`                           |
| Namespace events (Warning type)     | `kubectl get events -n <ns> --field-selector=type=Warning`          |
| Alarm context                       | AWS Console → CloudWatch → Alarms → alarm detail screenshot or JSON |
| Remediation applied                 | Free-text description of action taken                               |
| Verification output                 | `kubectl get pods -n <ns>` after remediation, showing healthy state |

Capture output to a file with a UTC timestamp in the filename:

```bash
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
kubectl describe pod <pod-name> -n <namespace> > "evidence-${TIMESTAMP}-pod-describe.txt"
kubectl logs <pod-name> -n <namespace> > "evidence-${TIMESTAMP}-pod-logs.txt"
kubectl get events -n <namespace> --sort-by='.lastTimestamp' > "evidence-${TIMESTAMP}-events.txt"
```

Attach evidence files to the incident ticket. The minimum required evidence set is defined in [diagnostic-bundle.md](diagnostic-bundle.md).
