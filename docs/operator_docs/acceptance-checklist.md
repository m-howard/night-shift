# Deployment Acceptance Checklist

> **Requirements:** REQ-DOC-001, REQ-DOC-002, REQ-DOC-005

This checklist converts the Epic 6 integration test suite into a repeatable, auditable sign-off workflow for environment rollouts. Each item maps to a concrete validation command or integration test, and must produce retained evidence before release acceptance is granted.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Phase 1 — Foundation Stack](#phase-1--foundation-stack)
4. [Phase 2 — Stateful Data Stack](#phase-2--stateful-data-stack)
5. [Phase 3 — Private Networking](#phase-3--private-networking)
6. [Phase 4 — ARC Readiness](#phase-4--arc-readiness)
7. [Phase 5 — Proxy Wiring](#phase-5--proxy-wiring)
8. [Phase 6 — Security Hardening](#phase-6--security-hardening)
9. [Phase 7 — Observability Readiness](#phase-7--observability-readiness)
10. [Sign-off & Evidence Retention](#sign-off--evidence-retention)

---

## Overview

### How to use this checklist

1. Deploy all three stacks to the target environment (`foundation`, `stateful-data`, `svc-compute`).
2. Work through each phase in order. Run the validation command or integration test for each item.
3. Record the pass/fail outcome and timestamp. Retain evidence as described in [Sign-off & Evidence Retention](#sign-off--evidence-retention).
4. The deployment is accepted when every item is marked **PASS** and the sign-off record is complete.

### Running the full integration test suite

The integration test suite exercises all phases below automatically and emits timestamped pass/fail evidence per item:

```bash
# Set target stack names
export FOUNDATION_STACK=moderna/github-runners-eks-foundation/dev
export STATEFUL_STACK=moderna/github-runners-eks-stateful-data/dev
export SVC_COMPUTE_STACK=moderna/github-runners-eks-compute/dev
export AWS_REGION=us-east-1

npm run test:integration
```

A passing run satisfies REQ-DOC-002 and REQ-DOC-005. Save the full output as evidence.

---

## Prerequisites

Before starting:

- [ ] AWS credentials configured for the target account (`aws sts get-caller-identity` succeeds)
- [ ] Pulumi logged in (`pulumi whoami` succeeds)
- [ ] `kubectl` available (check: `kubectl version --client`)
- [ ] All three stacks deployed to the target environment (foundation → stateful-data → svc-compute, in order)

---

## Phase 1 — Foundation Stack

**Test file:** `tests/stacks/foundation.integration.test.ts`

### ACC-F-001 — EBS default encryption enabled

**Requirement:** REQ-SEC-020  
**Validation:**

```bash
aws ec2 get-ebs-encryption-by-default --region us-east-1 --output json
```

**Expected:** `"EbsEncryptionByDefault": true`  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-F-002 — S3 account public access block enabled

**Requirement:** REQ-SEC-020  
**Validation:**

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3control get-public-access-block --account-id "$ACCOUNT_ID" --output json
```

**Expected:** All four flags (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`) are `true`.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Phase 2 — Stateful Data Stack

**Test file:** `tests/stacks/stateful-data.integration.test.ts`

### ACC-S-001 — Secrets Manager secret exists

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
aws secretsmanager describe-secret \
  --secret-id <coreSecretName> \
  --region us-east-1 \
  --output json
```

**Expected:** Response includes `"Name"` matching the configured `coreSecretName`.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-S-002 — Build-cache ECR repository correctly configured

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
aws ecr describe-repositories \
  --repository-names <appName>-build-cache \
  --region us-east-1 \
  --output json
```

**Expected:** `imageTagMutability: MUTABLE`, `imageScanningConfiguration.scanOnPush: true`, encryption type AES256 or KMS.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Phase 3 — Private Networking

**Test file:** `tests/stacks/svc-compute.integration.test.ts`, `tests/components/deployed-eks-components.integration.test.ts`

### ACC-N-001 — EKS cluster is ACTIVE

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
CLUSTER=$(pulumi stack output clusterName --stack moderna/github-runners-eks-compute/dev)
aws eks describe-cluster --name "$CLUSTER" --region us-east-1 \
  --query 'cluster.status' --output text
```

**Expected:** `ACTIVE`  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-N-002 — EKS cluster endpoint is private only

**Requirement:** REQ-NET-010 (Epic 2 task `github-runners-eks-85q`)  
**Validation:**

```bash
aws eks describe-cluster --name "$CLUSTER" --region us-east-1 \
  --query 'cluster.resourcesVpcConfig.{endpointPublicAccess:endpointPublicAccess,endpointPrivateAccess:endpointPrivateAccess}' \
  --output json
```

**Expected:** `endpointPublicAccess: false`, `endpointPrivateAccess: true`.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-N-003 — Platform namespaces exist

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
eksctl utils write-kubeconfig --cluster "$CLUSTER" --region us-east-1
kubectl get namespaces arc-system arc-runners arc-runners-arm64 \
  arc-coding-agents egress-proxy \
  -o name
```

**Expected:** All 5 namespaces returned with no errors.  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-N-004 — Coding-agent network policies exist

**Requirement:** REQ-NET-020 (Epic 2 task `github-runners-eks-bwt`)  
**Validation:**

```bash
kubectl get networkpolicy -n arc-coding-agents -o name
```

**Expected:** The `arc-coding-agents` namespace has `default-deny-ingress`, `default-deny-egress`, `allow-dns-egress`, `allow-kubernetes-api-egress`, and `allow-egress-proxy-egress`. Standard CI runner namespaces (`arc-runners` and `arc-runners-arm64`) do not currently have Kubernetes NetworkPolicies; they use injected proxy environment variables as the intended outbound path.

**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-N-005 — Cluster security group allows runner outbound egress

**Requirement:** REQ-EKS-009
**Validation:**

```bash
CLUSTER_SG=$(pulumi stack output clusterSecurityGroupId --stack moderna/github-runners-eks-compute/dev)
aws ec2 describe-security-group-rules \
  --filters "Name=group-id,Values=$CLUSTER_SG" "Name=is-egress,Values=true" \
  --query 'SecurityGroupRules[].{Cidr:CidrIpv4,Protocol:IpProtocol,From:FromPort,To:ToPort,Description:Description}' \
  --output table
```

**Expected:** `dev` and `prd` compute stacks include outbound egress from the cluster security group to `0.0.0.0/0`. Standard CI runner namespaces (`arc-runners` and `arc-runners-arm64`) do not currently have default-deny Kubernetes NetworkPolicies, so this allows direct outbound access when a build tool does not use the injected proxy settings. Coding-agent runners remain restricted by the `arc-coding-agents` namespace NetworkPolicies.

**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Phase 4 — ARC Readiness

**Test file:** `tests/stacks/svc-compute.integration.test.ts`

### ACC-A-001 — ARC controller deployment is Ready

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
kubectl get deployment -n arc-system \
  -l app.kubernetes.io/name=gha-rs-controller \
  -o jsonpath='{.items[0].status.readyReplicas}'
```

**Expected:** `1` (or more)  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-A-002 — All runner scale sets are registered and Ready

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
kubectl get autoscalingrunnersets.actions.github.com --all-namespaces
```

**Expected:** One `AutoscalingRunnerSet` per configured runner class (`linuxAmd64`, `linuxArm64`, `codingAgent`), all in a Ready state.  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-A-003 — Workload identity IAM roles exist

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
# Replace <role-name> with each workload identity role name from stack outputs
aws iam get-role --role-name <role-name> --output json \
  --query 'Role.{Arn:Arn,RoleName:RoleName}'
```

**Expected:** Each runner class has a corresponding IAM role with ARN matching `arn:aws:iam::*`.  
**Evidence:** Save JSON output with timestamp for each runner class.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-A-004 — ARC auth secret present in each runner namespace (when arcAuthSecretSync is enabled)

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
for NS in arc-runners arc-runners-arm64 arc-coding-agents; do
  echo "=== $NS ==="
  kubectl get secret <arcAuthSecretName> -n "$NS" -o jsonpath='{.metadata.name}'
done
```

**Expected:** The auth secret exists in all three runner namespaces.  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Phase 5 — Proxy Wiring

**Test file:** `tests/stacks/svc-compute.integration.test.ts`

### ACC-P-001 — Squid proxy deployment is healthy

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
kubectl get deployment squid-proxy -n egress-proxy \
  -o jsonpath='{.status.readyReplicas}/{.status.replicas}'
```

**Expected:** `2/2`  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-P-002 — Squid proxy ClusterIP Service exists on port 3128

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
kubectl get service squid-proxy -n egress-proxy \
  -o jsonpath='{.spec.type}:{.spec.ports[0].port}'
```

**Expected:** `ClusterIP:3128`  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-P-003 — Proxy env vars wired into proxied runner pods

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
# Check a proxied runner class scale set spec
kubectl get autoscalingrunnersets.actions.github.com \
  -n arc-runners <scale-set-name> \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .
```

**Expected:** `HTTP_PROXY` and `HTTPS_PROXY` both set to `http://squid-proxy.egress-proxy.svc.cluster.local:3128`.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-P-003b — Proxy env vars absent on non-proxied runner pods

**Requirement:** Per-runner-class proxy opt-out  
**Validation:**

```bash
# Check a non-proxied runner class scale set spec
kubectl get autoscalingrunnersets.actions.github.com \
  -n <non-proxied-namespace> <scale-set-name> \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .
```

**Expected:** No `HTTP_PROXY`, `HTTPS_PROXY`, or `NO_PROXY` env vars present.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-P-004 — Squid proxy endpoint present in stack outputs

**Requirement:** REQ-DOC-002  
**Validation:**

```bash
pulumi stack output squidProxyEndpoint --stack moderna/github-runners-eks-compute/dev
```

**Expected:** `http://squid-proxy.egress-proxy.svc.cluster.local:3128`  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Phase 6 — Security Hardening

**Test file:** `tests/components/deployed-eks-components.integration.test.ts`

### ACC-SH-001 — KMS encryption enabled for Kubernetes secrets

**Requirement:** REQ-SEC-020  
**Validation:**

```bash
aws eks describe-cluster --name "$CLUSTER" --region us-east-1 \
  --query 'cluster.encryptionConfig' --output json
```

**Expected:** At least one entry with `resources: ["secrets"]` and a `provider.keyArn` matching `arn:aws:kms:*`.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-SH-002 — Control plane logging enabled (all five log types)

**Requirement:** REQ-SEC-030  
**Validation:**

```bash
aws eks describe-cluster --name "$CLUSTER" --region us-east-1 \
  --query 'cluster.logging.clusterLogging[?enabled==`true`].types' \
  --output json
```

**Expected:** Output includes `api`, `audit`, `authenticator`, `controllerManager`, `scheduler`.  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-SH-003 — Pod Security Admission labels applied to all runner namespaces

**Requirement:** REQ-SEC-040  
**Validation:**

```bash
for NS in arc-runners arc-runners-arm64 arc-coding-agents; do
  echo "=== $NS ==="
  kubectl get namespace "$NS" \
    -o jsonpath='{.metadata.labels}' | jq .
done
```

**Expected:** Each runner namespace has `pod-security.kubernetes.io/enforce` label set to the appropriate PSA level (e.g. `restricted` or `baseline`).  
**Evidence:** Save command output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-SH-004 — No sensitive values leaking in stack outputs

**Requirement:** REQ-SEC-010  
**Validation:**

```bash
pulumi stack output --json --stack moderna/github-runners-eks-compute/dev | \
  grep -Ei '(PRIVATE KEY|ghp_|ghs_|github_pat_|AKIA[0-9A-Z]{16})'
```

**Expected:** No output — zero sensitive pattern matches.  
**Evidence:** Save command and the (empty) output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-SH-005 — VPC CNI addon ACTIVE

**Requirement:** REQ-NET-010  
**Validation:**

```bash
aws eks describe-addon --cluster-name "$CLUSTER" \
  --addon-name vpc-cni --region us-east-1 \
  --query 'addon.{name:addonName,status:status}' --output json
```

**Expected:** `status: ACTIVE`  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Phase 7 — Observability Readiness

**Test file:** `tests/stacks/svc-compute.integration.test.ts`

### ACC-O-001 — Container Insights addon ACTIVE

**Requirement:** REQ-OBS-010  
**Validation:**

```bash
aws eks describe-addon --cluster-name "$CLUSTER" \
  --addon-name amazon-cloudwatch-observability --region us-east-1 \
  --query 'addon.{name:addonName,status:status}' --output json
```

**Expected:** `status: ACTIVE`  
**Evidence:** Save JSON output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-O-002 — CloudWatch alarms exist and runbook URL is present

**Requirement:** REQ-OBS-020  
**Validation:**

```bash
# Verify alarm names are in stack outputs
pulumi stack output observabilityAlarmNames --json \
  --stack moderna/github-runners-eks-compute/dev

# Verify at least one alarm exists in CloudWatch
aws cloudwatch describe-alarms \
  --alarm-name-prefix github-runners-eks \
  --region us-east-1 \
  --query 'MetricAlarms[*].{Name:AlarmName,State:StateValue}' \
  --output table
```

**Expected:** `observabilityAlarmNames` output is non-empty; at least one alarm visible in CloudWatch.  
**Evidence:** Save JSON/table output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

### ACC-O-003 — Observability runbook URL present in stack outputs

**Requirement:** REQ-OBS-020  
**Validation:**

```bash
pulumi stack output observabilityRunbookUrl \
  --stack moderna/github-runners-eks-compute/dev
```

**Expected:** Non-empty URL.  
**Evidence:** Save output with timestamp.

| Outcome     | Date | Operator |
| ----------- | ---- | -------- |
| PASS / FAIL |      |          |

---

## Sign-off & Evidence Retention

### Who signs off

| Role                   | Sign-off requirement                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Deploying operator** | Must run all validation commands, record outcomes, and retain evidence.             |
| **Platform team lead** | Reviews evidence bundle and approves release acceptance for production deployments. |

A `dev` environment rollout requires deploying operator sign-off only.  
A `prd` environment rollout requires both deploying operator sign-off **and** platform team lead review.

### Evidence bundle

For each deployment, retain:

1. **Full `npm run test:integration` output** — timestamped stdout from the complete integration run, covering all phases above. This is the primary evidence artifact and satisfies REQ-DOC-005.
2. **AWS CLI outputs** for items validated manually (phases where automated test coverage is limited).
3. **Operator sign-off record** — a copy of this checklist with all items marked PASS, the deployment date, environment name, and operator name.

Retain evidence for a minimum of 90 days or per your organisation's audit retention policy.

### Integration test evidence format

The test suite emits timestamped evidence lines for each acceptance item:

```
[EVIDENCE] PASS  2026-03-23T14:00:29Z  svc-compute EKS output contract: cluster, namespaces, and network policies present
[EVIDENCE] PASS  2026-03-23T14:00:29Z  squid proxy endpoint present in stack outputs
[EVIDENCE] PASS  2026-03-23T14:00:29Z  cluster github-runners-eks-dev is ACTIVE
```

A test run that exits 0 with no FAIL evidence lines satisfies this checklist for the automated items.

### Release blocking criteria

A deployment is **not accepted** if any of the following items fail:

- ACC-N-002 (private endpoint only)
- ACC-N-004 (network policies in all runner namespaces)
- ACC-SH-001 (KMS secrets encryption)
- ACC-SH-002 (control plane logging)
- ACC-SH-004 (no secret leakage in outputs)

All other items are required for a complete sign-off but do not individually block release — document any FAIL with a linked remediation ticket.
