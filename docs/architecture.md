# Platform Architecture: GitHub Actions Self-Hosted Runners on EKS

## 1. Overview

This document describes the target architecture for a reusable Pulumi + TypeScript platform that runs GitHub Actions self-hosted runners on Amazon EKS with Auto Mode. It covers infrastructure layout, component design, data flow, security boundaries, and key technical decisions.

Companion documents:

- [Project Brief](project-brief.md) — problem/solution framing and scope boundaries.
- [Requirements](requirements.md) — EARS-formatted functional requirements catalog.
- [Framework Architecture](framework_architecture.md) — Pulumi Automation API layering conventions.

---

## 2. Design Principles

| Principle                  | How It Is Applied                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Feature-flag driven**    | Every optional subsystem gates on a boolean in `FeatureFlags`. Components are never instantiated unless their flag is `true`.                                                                                                                          |
| **Config-from-code**       | Environment-specific configuration lives in typed TypeScript files (`src/config/<env>.ts`). Each environment exports a `DefaultConfig` object loaded via `ConfigLoader`. Secrets are referenced by ARN, never stored in code.                          |
| **Proxy-first networking** | Runner namespaces default-deny egress. Internet-bound traffic routes through the in-cluster Squid proxy unless a runner class explicitly opts out via `egressProxy.enabled: false`, in which case its namespace receives direct internet egress rules. |
| **Least-privilege IAM**    | Runner pods have zero AWS permissions by default. AWS access is granted exclusively through per-runner-class IRSA roles.                                                                                                                               |
| **Auto Mode compute**      | No managed node groups. EKS Auto Mode provisions and scales nodes. Scheduling relies on architecture affinity and Auto Mode; `node-purpose` selectors are no longer used.                                                                              |
| **Immutable runner pods**  | Runners are ephemeral, scale-to-zero capable, and use the stock ARC runner image.                                                                                                                                                                      |

---

## 3. Deployment Model

### 3.1 Pulumi Automation API Orchestrator

The orchestrator ([src/index.ts](../src/index.ts)) drives deployments through three layers executed in strict order:

```
Creation order:  foundation → stateful-data → compute
Destroy order:   compute → stateful-data → foundation
```

Each layer is a separate Pulumi inline program with its own stack name (`<project>-<layer>/<env>`), enabling independent blast-radius scoping.

| Layer           | Scope                | Key Resources                                                           |
| --------------- | -------------------- | ----------------------------------------------------------------------- |
| `foundation`    | Account-wide         | S3 public-access block, EBS default encryption, KMS data-encryption key |
| `stateful-data` | Regional persistence | Secrets Manager entries, ECR repositories, GitHub OIDC IAM roles        |
| `compute`       | EKS + K8s workloads  | EKS cluster, namespaces, ARC, proxy, observability, integrations        |

CLI usage:

```bash
npm run deploy -- dev --scope compute          # single layer
npm run deploy -- prd                          # all layers
npm run preview -- dev --scope foundation      # dry-run
```

### 3.2 Environment Strategy

| Environment | Purpose                              | Config Source       |
| ----------- | ------------------------------------ | ------------------- |
| `dev`       | Rapid iteration, lower scale limits  | `src/config/dev.ts` |
| `prd`       | Production workloads, HA constraints | `src/config/prd.ts` |

Both environments deploy from the same code and component set. Differences are expressed entirely through typed `DefaultConfig` objects in `src/config/<env>.ts`. Adding a new environment requires creating a new config file, importing it in `src/config/index.ts`, and adding it to the environment registry.

---

## 4. Component Architecture

### 4.1 Component Dependency Graph

```
PlatformFoundationStack (compute layer, feature-flag driven)
│
├── EksCluster                                [always]
│   ├── KMS Key + Alias (secrets encryption)
│   ├── IAM Roles (cluster, addon management)
│   ├── OIDC Provider
│   ├── Security Group (ingress/egress rules)
│   └── EKS Addons (VPC CNI, EBS CSI, Pod Identity)
│
├── KubernetesProvider                        [always, from kubeconfig]
│
├── NamespaceBootstrap                        [always]
│   ├── Runner namespaces (arc-runners, arc-runners-arm64, arc-coding-agents, etc.)
│   ├── Control-plane namespaces (arc-system, egress-proxy)
│   ├── Pod Security Admission labels
│   └── Network Policies (default-deny, DNS, K8s API, proxy)
│
├── WorkloadIdentity                          [always]
│   └── IRSA bindings per service account
│
├── SquidProxy                                [deploySquidProxy=true]
│   ├── ConfigMap (allowlist ACLs)
│   ├── Deployment (2 replicas)
│   └── ClusterIP Service (squid.egress-proxy.svc:3128)
│
├── ArcController                             [deployArc=true]
│   ├── Helm: gha-runner-scale-set-controller (latest)
│   └── ServiceAccount with IRSA
│
├── ArcAuthSecretSync                         [deployArc=true, deployTokenBroker=false]
│   └── K8s Secrets from Secrets Manager → runner namespaces (legacy mode)
│
├── GitHubTokenBroker                         [deployTokenBroker=true]
│   ├── Lambda (token refresh, Node.js 20, inline handler)
│   ├── EventBridge schedule (rate(N minutes))
│   └── CloudWatch alarm (Lambda failure detection)
│
├── ExternalSecretsOperator                   [deployTokenBroker=true]
│   ├── Helm: external-secrets (external-secrets.io)
│   ├── ClusterSecretStore (AWS Secrets Manager via IRSA)
│   └── ExternalSecret per runner namespace → arc-github-auth
│
├── ArcRunnerScaleSets                        [deployArcRunnerScaleSets=true]
│   └── One Helm release per RunnerClassDefinition
│
├── Observability                             [deployObservability=true]
│   ├── Container Insights Addon              [deployContainerInsightsAddon=true]
│   ├── CloudWatch Alarms (pod failures, pending pods, node failures)
│   └── SNS notification wiring
│
├── CrowdStrike Falcon Sensor                 [deployCrowdstrikeFalconSensor=true]
└── Dynatrace Operator                        [deployDynatraceOperator=true]
```

### 4.2 Feature Flags

All optional components are gated by `FeatureFlags` defined in each environment's `DefaultConfig`:

| Flag                            | Default | Controls                                                                                   |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `deployArc`                     | `false` | ARC controller installation                                                                |
| `deployArcRunnerScaleSets`      | `false` | Runner scale set Helm releases                                                             |
| `deploySquidProxy`              | `false` | In-cluster Squid proxy                                                                     |
| `deployTokenBroker`             | `false` | Lambda token broker + External Secrets Operator (replaces `ArcAuthSecretSync` when `true`) |
| `tokenBrokerRefreshMinutes`     | —       | EventBridge schedule interval for Lambda token refresh (must be < 60; 30 recommended)      |
| `enableArcProxyEnv`             | `false` | Global default for `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` injection into runner pods    |
| `enableControllerProxyEnv`      | `false` | Separate toggle for proxy env injection into the ARC controller pod                        |
| `deployObservability`           | `false` | CloudWatch alarms and observability resources                                              |
| `deployContainerInsightsAddon`  | `false` | CloudWatch Container Insights EKS addon                                                    |
| `deployCrowdstrikeFalconSensor` | `false` | CrowdStrike Falcon sensor Helm chart                                                       |
| `deployDynatraceOperator`       | `false` | Dynatrace operator Helm chart                                                              |
| `hardenRunnerNamespaces`        | `true`  | PSA labels and network policies on runner namespaces                                       |
| `namespaceDefinitions`          | Derived | Namespace bootstrap definitions for control and runner namespaces                          |

Config validation enforces dependency constraints (e.g., `deployArcRunnerScaleSets` requires `deployArc`; `enableArcProxyEnv` requires either `deploySquidProxy` or explicit proxy URL overrides). Runner proxy injection can also be overridden per runner class via `egressProxy.enabled` on `RunnerClassConfig`; proxied and non-proxied classes must use separate namespaces.

---

## 5. Component Specifications

### 5.1 EKS Cluster

**Component**: `EksCluster` (`custom:aws:EksCluster`)

| Property            | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Auto Mode           | Enabled (no managed node groups)                                                 |
| K8s version         | Configurable, default `1.34`                                                     |
| API endpoint        | Private-only (`endpointPrivateAccess=true`, `endpointPublicAccess=false`)        |
| Authentication mode | `API` (Auto Mode requirement)                                                    |
| Control-plane logs  | `api`, `audit`, `authenticator`, `controllerManager`, `scheduler`                |
| Secret encryption   | Customer-managed KMS key with rotation, alias `alias/<cluster>-eks-secrets`      |
| Addons              | VPC CNI (network observability), EBS CSI, Pod Identity Agent, Container Insights |

**Inputs**: VPC ID, subnet IDs, public access CIDRs, KMS config, tags
**Outputs**: `clusterName`, `clusterEndpoint`, `clusterCertificateAuthority`, `clusterSecurityGroupId`, `kubeconfig`, `oidcProviderArn`

### 5.2 Namespace Bootstrap

**Component**: `NamespaceBootstrap` (`github-runners-eks:kubernetes:NamespaceBootstrap`)

Creates all platform namespaces and applies baseline controls:

The compute stack reads namespace definitions from `config.namespaceDefinitions`, which defaults to `arc-system`, `egress-proxy`, and every namespace referenced by `runnerClasses`.

| Namespace           | Purpose                      | Network Policy                                 | Egress Mode                 |
| ------------------- | ---------------------------- | ---------------------------------------------- | --------------------------- |
| `arc-system`        | ARC controller               | None                                           | Proxy (controller-specific) |
| `arc-runners`       | General amd64 runners        | None                                           | Per runner class config     |
| `arc-runners-arm64` | General arm64 runners        | None                                           | Per runner class config     |
| `arc-coding-agents` | Copilot coding agent runners | Default-deny + DNS + K8s API + proxy or direct | Per runner class config     |
| `egress-proxy`      | Squid proxy                  | None                                           | No (is the proxy)           |

**Pod Security Admission labels** (applied to all namespaces):

```yaml
pod-security.kubernetes.io/enforce: baseline
pod-security.kubernetes.io/warn: restricted
pod-security.kubernetes.io/audit: restricted
```

Build-runner namespaces do not require a PSA exception. Both the runner container and the rootless BuildKit sidecar are hardened with explicit `securityContext` settings (non-root UID 1000, `allowPrivilegeEscalation: false`, `RuntimeDefault` seccomp), making them compatible with `baseline` enforcement. The only current privileged exception is the separate CrowdStrike sensor namespace.

**Network Policies** (applied to `arc-coding-agents` only, via `RunnerNamespaceNetworkPolicies`):

Runner classes that set `networkPolicy: true` opt their namespace into default-deny network policies. Currently only the `codingAgent` runner class enables this. Other runner namespaces (`arc-runners`, `arc-runners-arm64`) and infrastructure namespaces (`arc-system`, `egress-proxy`) do not receive Kubernetes NetworkPolicy objects.

1. `default-deny-ingress` — blocks all inbound traffic
2. `default-deny-egress` — blocks all outbound traffic
3. `allow-cluster-dns-egress` — allows UDP/TCP 53 to `kube-dns` in `kube-system`
4. `allow-kubernetes-api-egress` — allows TCP 443 to the Kubernetes API server endpoint
5. `allow-egress-proxy-egress` — allows TCP to `egress-proxy` namespace on the configured proxy port (proxied namespaces only)
6. `allow-direct-internet-egress` — allows TCP 80/443 to `0.0.0.0/0` (non-proxied namespaces only, where all runner classes set `egressProxy.enabled: false`)

### 5.3 ARC Controller

**Component**: `ArcController` (to be implemented)

Deploys the Actions Runner Controller via Helm.

| Property      | Value                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helm chart    | `gha-runner-scale-set-controller`                                                                                                                                                      |
| Chart version | Latest stable                                                                                                                                                                          |
| Namespace     | `arc-system`                                                                                                                                                                           |
| Runner image  | Stock `ghcr.io/actions/actions-runner`                                                                                                                                                 |
| Auth method   | Short-lived GitHub installation token via token broker (`deployTokenBroker: true`, recommended) or GitHub App credentials via `ArcAuthSecretSync` (`deployTokenBroker: false`, legacy) |

**Auth secret contract** (K8s Secret `arc-github-auth` in each runner namespace):

Token broker mode (`deployTokenBroker: true`):

```yaml
data:
    github_token: <base64-encoded ghs_* installation token>
```

The `github_token` is a short-lived GitHub installation token (`ghs_*`) with a 1-hour expiry. External Secrets Operator refreshes it from Secrets Manager every 5 minutes; the Lambda token broker renews the underlying Secrets Manager value every `tokenBrokerRefreshMinutes` (default 30). The private key never leaves Secrets Manager or Lambda memory.

Legacy mode (`deployTokenBroker: false`):

```yaml
data:
    github_app_id: <base64>
    github_app_installation_id: <base64>
    github_app_private_key: <base64>
```

**Dependency**: Requires `NamespaceBootstrap` (for `arc-system` namespace). Auth secret availability requires either `ExternalSecretsOperator` (token broker mode) or `ArcAuthSecretSync` (legacy mode) to have completed successfully before runner scale sets are deployed.

### 5.4 ARC Runner Scale Sets

**Component**: `ArcRunnerScaleSet`

Deploys one `gha-runner-scale-set` Helm release per `RunnerClassConfig` entry in the environment's `runnerClasses` array.

Each release binds the runner Pod template to the per-class IRSA service account, reuses the synced GitHub App auth secret, exports the rendered scale-set name, and applies architecture-aware node selection plus per-class resource sizing.

**Runner class catalog (per-environment)**:

Runner classes are defined explicitly in each environment config file (`src/config/<env>.ts`). Different environments may define different runner catalogs — for example, dev may include experimental runner classes that production does not. The table below shows the baseline classes shipped with both `dev` and `prd`:

| Class         | Labels                                                | Arch  | CPU | Memory | Storage | Build Engine / Cache | Max Duration |
| ------------- | ----------------------------------------------------- | ----- | --- | ------ | ------- | -------------------- | ------------ |
| `linuxAmd64`  | `linux` / `linux-{env}`                               | amd64 | 4   | 8Gi    | 80Gi    | BuildKit + ECR cache | 90 min       |
| `linuxArm64`  | `linux-arm64` / `linux-arm64-{env}`                   | arm64 | 4   | 8Gi    | 80Gi    | BuildKit + ECR cache | 90 min       |
| `codingAgent` | `copilot-coding-agent` / `copilot-coding-agent-{env}` | amd64 | 4   | 8Gi    | 40Gi    | BuildKit + ECR cache | 480 min      |

Each runner class exposes exactly one routing label. Non-production environments append `-<env>` (e.g. `-dev`); production uses the base label unchanged. All runner classes include a rootless BuildKit sidecar and an ECR registry cache.

To add, remove, or customise runner classes for a specific environment, edit the `runnerClasses` array in the corresponding `src/config/<env>.ts` file. Namespace definitions are derived automatically from the runner catalog via `buildDefaultNamespaceDefinitions()`. Config validation ensures runner class names are unique and that every runner namespace is present in `namespaceDefinitions`.

**Node scheduling**:

- All runner classes use EKS Auto Mode Karpenter NodePools for compute provisioning
- Architecture-based scheduling: `kubernetes.io/arch: <arch>` and `kubernetes.io/os: linux` nodeSelectors are applied automatically based on each runner class's `architecture` field
- amd64 runners schedule on the built-in `general-purpose` NodePool
- arm64 runners schedule on the `general-purpose-arm64` NodePool (Graviton instances)
- EBS storage: Auto Mode native `ebs.csi.eks.amazonaws.com` provisioner via `gp3` StorageClass

### 5.4.1 Build Engine & Cache

All runner classes include a rootless BuildKit sidecar that enables OCI image builds without host Docker socket access.

**BuildKit sidecar**:

| Property          | Value                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Image             | `moby/buildkit:rootless` (configurable via `buildEngine.image`)                 |
| Socket            | `unix:///run/user/1000/buildkit/buildkitd.sock` (emptyDir volume)               |
| Security context  | `runAsUser: 1000`, `allowPrivilegeEscalation: false`, `seccomp: RuntimeDefault` |
| PSA compatibility | Compatible with `baseline` enforcement (no privileged exception)                |
| Worker mode       | `--oci-worker-no-process-sandbox` (rootless in Kubernetes)                      |

**Runner container security context** (applied to all runner classes):

| Property                   | Value                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `runAsUser`                | `1000` (matches BuildKit sidecar and `actions-runner` image user) |
| `runAsGroup`               | `1000`                                                            |
| `runAsNonRoot`             | `true`                                                            |
| `allowPrivilegeEscalation` | `false`                                                           |
| `readOnlyRootFilesystem`   | `false` (runner requires writable `/home/runner`, `/tmp`)         |
| `seccompProfile`           | `RuntimeDefault`                                                  |
| PSA compatibility          | Compatible with `baseline` and `restricted` enforcement           |

The runner container receives `BUILDKIT_HOST` pointing at the shared socket so `docker buildx` and `buildctl` commands work transparently.

**Docker socket mount guard**: Config validation rejects runner classes that attempt to mount
`/var/run/docker.sock` or `/run/docker.sock`. The `buildRunnerTemplateSpec` also performs a runtime
assertion before generating the pod template.

**ECR registry cache** (`buildEngine.ecrCache`):

| Setting       | Default | Description                                              |
| ------------- | ------- | -------------------------------------------------------- |
| `enabled`     | `true`  | Enable `type=registry` cache backend for BuildKit        |
| `registryUrl` | —       | ECR registry URL used as cache backend (set per account) |
| `cachePrefix` | —       | Key prefix to avoid cache collisions across repos        |
| `maxAgeDays`  | 14      | Advisory maximum age before layers are considered stale  |

Workflows use `--cache-to type=registry,ref=<url>/<prefix>` and `--cache-from type=registry,ref=<url>/<prefix>` to leverage warm caches across builds.

**Ephemeral storage sizing**:

The `linuxAmd64` and `linuxArm64` classes default to 80 Gi ephemeral storage and an 80 Gi work volume. The `codingAgent` class provides 40 Gi ephemeral storage and a 40 Gi work volume. The maximum recommended build-context size is **10 Gi** uncompressed for a single-stage build. Monorepo strategies should use sparse checkout or `.dockerignore` to keep the context under this limit.

### 5.5 Squid Egress Proxy

**Component**: `SquidProxy` (to be implemented)

| Property         | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| Namespace        | `egress-proxy`                                             |
| Replicas         | 2 (HA in `prd`)                                            |
| Service          | `ClusterIP` at `squid.egress-proxy.svc.cluster.local:3128` |
| Allowlist source | `PlatformStackConfig.proxy.allowlist[]`                    |

**Allowlist entry structure** (`ProxyAllowlistEntry`):

```typescript
{
  destinationType: 'domain' | 'domainSuffix' | 'cidr',
  destination: string,       // e.g. 'github.com' or '.githubusercontent.com'
  ports: number[],           // e.g. [443]
  justification: string,
  owner: string,
  reviewRef: string,
  expiresOn?: string,
}
```

**ARC proxy wiring**:

Proxy configuration is split into two independent paths:

**Controller proxy** (when `enableControllerProxyEnv=true`):
Controller pods receive `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (and lowercase variants) from `controllerProxyHttpUrl` / `controllerProxyHttpsUrl` / `controllerProxyNoProxy`. If no explicit URL is provided, the Squid endpoint is used as the default when `deploySquidProxy=true`.

**Runner proxy** (when `enableArcProxyEnv=true`, per-class override via `egressProxy`):
Runner pods receive proxy env vars by default. Individual runner classes can opt out by setting `egressProxy: { enabled: false }`, and can extend `NO_PROXY` via `egressProxy.additionalNoProxy`. Non-proxied runner classes must use a dedicated namespace; their namespace receives an `allow-direct-internet-egress` policy (TCP 80/443 to `0.0.0.0/0`) instead of the proxy egress rule.

Explicit URL overrides via `arcProxyHttpUrl` / `arcProxyHttpsUrl` take precedence over Squid defaults.

### 5.6 ARC Auth Secret Sync (Legacy)

> **Mode**: Active when `deployTokenBroker: false`. For new deployments, the token broker mode (`deployTokenBroker: true`) described in sections 5.6.1–5.6.2 is recommended because the GitHub App private key never enters the cluster.

**Component**: `ArcAuthSecretSync`

Materializes GitHub App credentials from AWS Secrets Manager into K8s secrets across runner namespaces.

The shared/core secret may store `github_app_private_key` as either plaintext PEM content or a single-line base64-encoded PEM value. Base64 payloads are decoded before the Kubernetes secret is created.

**Secret sourcing** (one of):

1. **Core secret path** — when `deployArc=true`, the component reads GitHub App credentials from the shared Secrets Manager secret referenced by `coreSecretName`.
2. **Secrets Manager override** — `secretsManagerArn` may point to a different Secrets Manager secret ID or ARN when ARC auth should be sourced from a dedicated secret instead of the shared core secret.
3. **Pulumi secret config** — `githubAppId`, `githubAppInstallationId`, `githubAppPrivateKey` provided as Pulumi secret config values (encrypted at rest in Pulumi state, never in source code).

**Constraint**: Secret material must never appear in source code, stack outputs, or logs. Config validation rejects deployment if `deployArc=true` and neither `coreSecretName`, `secretsManagerArn`, nor Pulumi secret config values provide a usable secret source.

### 5.6.1 GitHub Token Broker (Recommended)

> **Mode**: Active when `deployTokenBroker: true`. Replaces `ArcAuthSecretSync`. The GitHub App private key stays in Secrets Manager and Lambda memory only — it is never written to a Kubernetes secret.

**Component**: `GitHubTokenBroker`

| Property            | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| Lambda runtime      | Node.js 20                                                    |
| Lambda memory       | 128 MB                                                        |
| Lambda timeout      | 30 seconds                                                    |
| Schedule            | EventBridge `rate(tokenBrokerRefreshMinutes minutes)`         |
| Refresh interval    | `tokenBrokerRefreshMinutes` (must be < 60; 30 recommended)    |
| Token expiry        | 1 hour (GitHub installation token)                            |
| IAM (source secret) | `secretsmanager:GetSecretValue` on private-key source secret  |
| IAM (token secret)  | `secretsmanager:PutSecretValue` on the generated token secret |

**Flow**:

1. EventBridge fires the Lambda on the configured schedule.
2. Lambda reads `github_app_id`, `github_app_installation_id`, `github_app_private_key` from the source Secrets Manager secret.
3. Lambda builds a JWT signed with the private key and exchanges it for a GitHub installation access token (`ghs_*`, 1-hour expiry) via `POST /app/installations/{id}/access_tokens`.
4. Lambda writes `{ "github_token": "<ghs_*>" }` to the token Secrets Manager secret. The private key is never stored or emitted beyond Lambda memory.
5. A CloudWatch alarm fires if the Lambda produces any errors.

**Stack outputs**: `tokenBrokerLambdaName`, `tokenBrokerSecretArn`, `tokenBrokerFailureAlarmName`.

### 5.6.2 External Secrets Operator

> **Mode**: Active when `deployTokenBroker: true`. Syncs the short-lived token from Secrets Manager into each runner namespace Kubernetes secret.

**Component**: `ExternalSecretsOperator`

| Property               | Value                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Helm chart             | `external-secrets/external-secrets` (https://charts.external-secrets.io)                                                        |
| CRD API version        | `external-secrets.io/v1`                                                                                                        |
| ClusterSecretStore     | `external-secrets-operator-aws-sm` (AWS Secrets Manager provider, IRSA); `conditions` restricts usage to runner namespaces only |
| ExternalSecret refresh | `5m` (re-syncs K8s secret from Secrets Manager every 5 minutes)                                                                 |
| IAM scope              | `secretsmanager:GetSecretValue` on the token secret only (not the source key)                                                   |
| Namespaces covered     | All runner namespaces (`arc-runners`, `arc-runners-arm64`, `arc-coding-agents`)                                                 |

**What gets synced**:

Each `ExternalSecret` resource maps the `github_token` key from the token Secrets Manager secret into a K8s `Opaque` secret named `arc-github-auth` in each runner namespace. ARC runner scale sets reference this secret by name as their `githubConfigSecret`.

**Stack output**: `esoServiceAccountRoleArn`.

### 5.7 Observability

**Component**: `Observability` (to be implemented)

| Resource           | Details                                                     |
| ------------------ | ----------------------------------------------------------- |
| Container Insights | EKS addon `amazon-cloudwatch-observability` (conditional)   |
| Pod failure alarm  | Per runner namespace, CloudWatch metric alarm               |
| Pending pods alarm | Cluster-wide, fires when pods stay pending beyond threshold |
| Failed nodes alarm | Cluster-wide, fires on node `NotReady` conditions           |
| SNS routing        | Optional `alarmSnsTopicArn` for notification delivery       |
| Runbook URL        | Exported in stack outputs for alarm-to-runbook mapping      |

### 5.8 Workload Identity (IRSA)

**Component**: `WorkloadIdentity`

Creates IAM Roles for Service Accounts (IRSA) bindings for Kubernetes workloads that need AWS access.

- Trust policies scope exact `sub` (service account) and `aud` claims.
- Service accounts receive `eks.amazonaws.com/role-arn` annotation.
- Runner pods have **no AWS permissions by default** — IRSA roles are explicitly provisioned only for runner classes that need them.
- The compute stack exports per-runner-class role ARN, role name, and service account name mappings for downstream ARC runner scale set wiring.

---

## 6. Container Build Strategy

### 6.1 Build Engine: Rootless BuildKit Sidecar

EKS Auto Mode does not allow SSH/SSM node access or host Docker daemon configuration. The platform uses **rootless BuildKit running as a sidecar container** in runner pods.

| Decision                            | Rationale                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BuildKit (rootless)** over Kaniko | Native `docker build` / `docker buildx` CLI compatibility with GitHub Actions. No workflow syntax changes. Supports multi-stage builds and build arguments natively. |
| **Sidecar pattern**                 | BuildKit daemon runs alongside the runner container in the same pod. No host socket mount required. Works with PSA `baseline` enforcement.                           |
| **No host Docker socket**           | `REQ-DOCKER-AM-011`: Workflows attempting socket-mount builds fail fast with guidance.                                                                               |

### 6.2 Build Cache: ECR Registry Cache

Build caching uses **ECR registry-backed cache** for lowest latency:

| Decision                       | Rationale                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ECR registry cache** over S3 | Lower latency for layer pulls within the same region. No additional S3 bucket provisioning. Native integration with `docker buildx build --cache-to type=registry`. |
| Cache reference                | `--cache-to type=registry,ref=<account>.dkr.ecr.<region>.amazonaws.com/<repo>:cache`                                                                                |
| Retention                      | ECR lifecycle policies apply; cache images expire after configurable period.                                                                                        |

### 6.3 Runner Isolation

Runner classes run on EKS Auto Mode managed nodes with isolation achieved through:

- **Namespace separation**: amd64 workloads run in `arc-runners`, arm64 workloads run in `arc-runners-arm64`, and agent workloads run in `arc-coding-agents`.
- **Architecture affinity**: Runners include `kubernetes.io/arch` nodeSelector matching their configured architecture.
- **Network policies**: The `arc-coding-agents` namespace receives default-deny ingress/egress network policies with selective allow rules for DNS, Kubernetes API, and proxy or direct internet access (controlled by the `networkPolicy: true` flag on the runner class). Other runner namespaces do not have Kubernetes NetworkPolicy objects; their egress is governed by proxy environment variable injection only.
- **Resource requests**: Karpenter right-sizes nodes to satisfy each runner class's CPU, memory, and storage profile.

Runner classes receive:

- `linuxAmd64`: 80 Gi ephemeral storage, 80 Gi work volume, 90-minute max duration
- `linuxArm64`: 80 Gi ephemeral storage, 80 Gi work volume, 90-minute max duration
- `codingAgent`: 40 Gi ephemeral storage, 40 Gi work volume, 480-minute max duration

---

## 7. Security Architecture

### 7.1 Network Security

```
┌─────────────────────────────────────────────────────────┐
│ EKS Cluster (Private Subnets)                           │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │ arc-runners  │    │ arc-runners- │                   │
│  │              ├────►│ arm64       │                   │
│  │ (proxy env   │    │ (proxy env   │                   │
│  │  only)       │    │  only)       │                   │
│  └──────┬───────┘    └──────┬───────┘                   │
│         │ (port 3128)       │ (port 3128)               │
│         ▼                   ▼                           │
│  ┌──────────────────────────────────┐                   │
│  │ egress-proxy (Squid)             │                   │
│  │ Allowlist: github.com, ECR, etc. │                   │
│  └──────────────┬───────────────────┘                   │
│                 │                                       │
│                 ▼                                       │
│  ┌──────────────────────────────────┐                   │
│  │ NAT Gateway / VPC Egress         │                   │
│  └──────────────────────────────────┘                   │
│                                                         │
│  ┌──────────────────┐                                   │
│  │ arc-coding-agents │                                  │
│  │ NetworkPolicy     │                                  │
│  │ default-deny      │                                  │
│  └──────┬────────────┘                                  │
│         │ (port 3128)                                   │
│         ▼                                               │
│  (egress-proxy or direct, per runner class config)      │
└─────────────────────────────────────────────────────────┘
```

**Controls**:

- Cluster API endpoint is private-only (public access disabled by default).
- Proxied runner pods cannot reach the internet directly; non-proxied runner classes use dedicated namespaces with direct internet egress policies.
- Squid enforces domain/CIDR allowlists with justification and review tracking.
- Cluster security group egress is explicitly managed with configurable CIDRs.
- Public endpoint access, if enabled, is constrained to `publicAccessCidrs`.

### 7.2 Secrets Management

| Secret Type            | Storage              | Delivery                                 | In-Code |
| ---------------------- | -------------------- | ---------------------------------------- | ------- |
| GitHub App credentials | AWS Secrets Manager  | Pulumi reads at deploy time → K8s Secret | Never   |
| CrowdStrike tokens     | Pulumi secret config | Helm values via `pulumi.secret()`        | Never   |
| Dynatrace tokens       | Pulumi secret config | Helm values via `pulumi.secret()`        | Never   |
| KMS key material       | AWS-managed          | KMS API                                  | Never   |

**Constraints**:

- Secrets never appear in source code (encrypted or otherwise).
- Secrets never appear in Pulumi stack outputs or deployment logs (`showSecrets: false`).
- Config validation fails if required secret inputs are missing when their feature flag is enabled.
- GitHub App credential rotation is supported through Secrets Manager update + Pulumi redeploy.

### 7.3 IAM Architecture

```
EKS Cluster IAM Role
├── Cluster service role (eks.amazonaws.com)
├── Addon management policy
│   └── iam:PassRole scoped to *-eks-addon-* roles + eks.amazonaws.com
│
OIDC Provider (for IRSA)
├── ARC Controller ServiceAccount → IAM Role (ARC-specific permissions)
├── Runner SA (default) → No IAM Role (zero permissions)
└── Runner SA (selected runner classes) → IAM Role (ECR push/pull for registry cache)
```

---

## 8. Configuration Architecture

### 8.1 Config Flow

```
src/config/dev.ts  (or prd.ts, val.ts)
      │
      ▼
src/config/index.ts  ← EnvironmentConfig registry
      │
      ▼
ConfigLoader.loadConfig<DefaultConfig>(config, envName)
      │
      ├── DefaultConfig (typed TypeScript object)
    │     ├── deployArc            (boolean)
    │     ├── deployArcRunnerScaleSets (boolean)
      │     ├── coreSecretName       (Secrets Manager path)
    │     ├── arcAuthSecretName    (Kubernetes secret name)
      │     ├── domainName           (string)
      │     ├── hostedZoneId         (Route53 zone)
      │     ├── clusterAdminRoleArn  (IAM role ARN)
      │     ├── networking           (VpcInfo: vpcId, subnets)
    │     ├── runnerClasses        (RunnerClassConfig[])
    │     ├── deploySquidProxy     (boolean)
    │     ├── enableArcProxyEnv    (boolean)
    │     ├── deployObservability  (boolean)
    │     ├── hardenRunnerNamespaces (boolean)
      │     ├── tags                 (TagsInfo: owner, dept, env, etc.)
      │     ├── eks                  (EksConfig: version, clusterName)
      │     └── integrations         (CrowdStrike, Dynatrace configs)
      │
      ▼
Stack functions receive typed DefaultConfig
      │
      ▼
Component constructors receive typed config slices
```

### 8.2 Adding a New Environment

1. Create `src/config/<env>.ts` exporting a `DefaultConfig` object.
2. Import and register it in `src/config/index.ts`.
3. The orchestrator resolves the config by environment name.

```typescript
// src/config/val.ts
import { DefaultConfig } from '../components/types';

export const config: DefaultConfig = {
    deployArc: false,
    coreSecretName: '/val/cicada/github/core/runners/eks',
    domainName: 'val.btp.modernatx.net',
    // ... remaining config
};
```

### 8.3 Runner Class Configuration

Runner classes are defined in each environment's `DefaultConfig` as a `RunnerClassConfig[]`:

```typescript
// Inside src/config/dev.ts
runnerClasses: [
    {
        name: 'linuxAmd64',
        labels: ['linux'],
        minRunners: 0,
        maxRunners: 10,
        architecture: 'amd64',
        namespace: 'arc-runners',
        cpu: '4',
        memory: '8Gi',
        ephemeralStorage: '80Gi',
        workVolumeSize: '80Gi',
        maxJobDurationMinutes: 90,
    },
    {
        name: 'linuxArm64',
        labels: ['linux-arm64'],
        minRunners: 0,
        maxRunners: 10,
        architecture: 'arm64',
        namespace: 'arc-runners-arm64',
        cpu: '4',
        memory: '8Gi',
        ephemeralStorage: '80Gi',
        workVolumeSize: '80Gi',
        maxJobDurationMinutes: 90,
    },
    {
        name: 'codingAgent',
        labels: ['copilot-coding-agent'],
        minRunners: 0,
        maxRunners: 4,
        architecture: 'amd64',
        namespace: 'arc-coding-agents',
        cpu: '4',
        memory: '8Gi',
        ephemeralStorage: '40Gi',
        workVolumeSize: '40Gi',
        maxJobDurationMinutes: 480,
    },
],
```

When `runners` is not specified, the environment config file (`src/config/<env>.ts`) supplies the runner classes documented in section 5.4.

---

## 9. Stack Outputs Contract

The platform exports a structured `PlatformFoundationStackOutputs` object:

| Output                     | Type                                            | Purpose                                                          |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `stackContractVersion`     | `string`                                        | Schema version for output compatibility                          |
| `environment`              | `string`                                        | Deployment environment name                                      |
| `githubOrganization`       | `string?`                                       | GitHub org for ARC registration                                  |
| `network`                  | `NetworkSummaryOutput`                          | VPC ID, subnet counts                                            |
| `featureFlags`             | `FeatureFlags`                                  | Active feature flag state                                        |
| `runnerClasses`            | `string[]`                                      | Names of deployed runner classes                                 |
| `namespaces`               | `Record<string, NamespaceStackOutput>`          | Namespace metadata (name, labels, annotations)                   |
| `workloadIdentityBindings` | `Record<string, WorkloadIdentityBindingOutput>` | SA-to-IAM-role mappings                                          |
| `kubeconfig`               | `unknown`                                       | Cluster access credential (secret)                               |
| `cluster`                  | `ClusterMetadataOutput`                         | Cluster ARN, endpoint, SG, OIDC, auth mode, Auto Mode, log types |

---

## 10. Implementation Phases

| Phase                          | Components                                                        | Requirements                                       | Status      |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------- | ----------- |
| **Phase 1: Core Platform**     | EKS cluster, namespaces, workload identity, security baseline     | REQ-EKS-_, REQ-K8S-_, REQ-SEC-001–004, REQ-HARD-\* | Implemented |
| **Phase 2: Egress Proxy**      | Squid proxy component, allowlist config, proxy network policies   | REQ-PROXY-\*                                       | Not started |
| **Phase 3: ARC Controller**    | ARC Helm chart, GitHub auth secret sync                           | REQ-ARC-001–004, REQ-AUTH-\*                       | Not started |
| **Phase 4: Runner Scale Sets** | Runner class Helm releases, proxy env wiring                      | REQ-ARC-005–011, REQ-RUN-\*                        | Not started |
| **Phase 5: Docker Builds**     | BuildKit sidecar config, ECR cache, arm64 NodePool                | REQ-DOCKER-AM-\*                                   | Implemented |
| **Phase 6: Observability**     | CloudWatch alarms, Container Insights, SNS routing                | REQ-OBS-\*                                         | Not started |
| **Phase 7: Documentation**     | User guides, runbooks, label catalog, quickstart, troubleshooting | REQ-DOC-\*                                         | Not started |

---

## 11. Technical Decisions Record

| #      | Decision               | Choice                                                    | Rationale                                                                                                                                                                                                     |
| ------ | ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-001 | Container build engine | Rootless BuildKit sidecar                                 | Native GitHub Actions CLI compatibility (`docker buildx`). Works without host Docker socket or privileged access. Compatible with PSA `baseline` enforcement on Auto Mode.                                    |
| TD-002 | Build cache backend    | ECR registry cache                                        | Lowest latency for same-region layer pulls. No extra S3 provisioning. Native `--cache-to type=registry` support.                                                                                              |
| TD-003 | ARC chart version      | Latest stable                                             | Track upstream releases. Pin to latest at deploy time.                                                                                                                                                        |
| TD-004 | Runner base image      | Stock `ghcr.io/actions/actions-runner`                    | Reduces maintenance burden. Custom images deferred until a proven gap exists.                                                                                                                                 |
| TD-005 | Secrets delivery       | AWS Secrets Manager → Pulumi reads at deploy → K8s Secret | Secrets never in source code (encrypted or not). Secrets Manager provides audit trail, rotation support, and IAM-scoped access. Pulumi secret config used as alternative for non-Secrets-Manager credentials. |
| TD-006 | Deployment model       | Single Pulumi program per layer, feature-flag driven      | Simpler state management than one-stack-per-component. Feature flags allow incremental rollout without stack proliferation.                                                                                   |
| TD-007 | Compute provisioning   | EKS Auto Mode                                             | No node group management. Auto Mode handles scaling, patching, and instance selection. Build runners isolated via `nodeSelector`.                                                                             |

---

## 12. Directory Structure

```
src/
├── index.ts                          # Pulumi Automation API orchestrator
├── config/
│   ├── index.ts                      # Environment config registry
│   ├── dev.ts                        # Dev environment config (DefaultConfig)
│   └── prd.ts                        # Prd environment config (DefaultConfig)
├── components/
│   ├── index.ts                      # Component barrel exports
│   ├── aws/
│   │   ├── ecr/index.ts              # ECR repository component
│   │   ├── eks/index.ts              # EKS cluster component
│   │   ├── s3/index.ts               # S3 bucket component
│   │   └── secret/index.ts           # Secrets Manager component
│   ├── kubernetes/
│   │   ├── namespaces.ts             # Namespace bootstrap + network policies
│   │   ├── crowdstrike/index.ts      # CrowdStrike Falcon Helm
│   │   └── dynatrace/index.ts        # Dynatrace operator Helm
│   └── types/
│       ├── config.ts                 # Config interfaces (DefaultConfig, VpcInfo, etc.)
│       ├── platform-outputs.ts       # Stack output type contracts
│       ├── pulumi-stack.ts           # Base StackOutputs
│       └── index.ts                  # Type barrel exports
├── stacks/
│   ├── foundation.ts                 # Foundation layer stack
│   ├── stateful-data.ts              # Stateful data layer stack
│   └── svc-compute.ts               # Compute layer stack (EKS + K8s)
└── helpers/
    ├── index.ts                      # Helper barrel exports
    ├── ips.ts                        # CIDR range constants
    └── pulumi.ts                     # Auto-tagging, output guards
```

Components to be added:

```
src/components/
├── kubernetes/
│   ├── arc-controller/index.ts       # ARC Helm controller
│   ├── arc-runner-scale-sets/index.ts # Runner scale set Helm releases
│   ├── arc-auth-secret/index.ts      # GitHub auth secret sync
│   └── squid-proxy/index.ts          # Squid egress proxy
├── aws/
│   └── observability/index.ts        # CloudWatch alarms + SNS
```

---

## 13. Integration Testing Strategy

Integration tests verify that AWS and Kubernetes resources are **actually deployed, configured, and running correctly** in the target environment. They run against real infrastructure after a deployment.

### 13.1 Test Organization

```
tests/
├── setup.ts                              # Shared test utilities, AWS/K8s client setup
├── e2e/
│   ├── eks-cluster.e2e.spec.ts           # EKS cluster configuration checks
│   ├── namespaces.e2e.spec.ts            # Namespace existence, PSA labels, network policies
│   ├── security.e2e.spec.ts              # KMS, IAM, security group, OIDC checks
│   ├── arc-controller.e2e.spec.ts        # ARC Helm release readiness, pods running
│   ├── arc-runners.e2e.spec.ts           # Runner scale set readiness, label registration
│   ├── proxy.e2e.spec.ts                 # Squid proxy deployment, service reachability
│   ├── observability.e2e.spec.ts         # CloudWatch alarms exist, SNS subscription
│   └── workload-identity.e2e.spec.ts     # IRSA role bindings, SA annotations
└── jest-e2e.json                         # E2E test config (longer timeout, sequential)
```

### 13.2 Test Categories

#### EKS Cluster Verification (`eks-cluster.e2e.spec.ts`)

Uses AWS SDK (`@aws-sdk/client-eks`) to query the live cluster and assert:

| Check                             | API               | Assertion                                                             |
| --------------------------------- | ----------------- | --------------------------------------------------------------------- |
| Cluster exists and is ACTIVE      | `DescribeCluster` | `status === 'ACTIVE'`                                                 |
| Kubernetes version matches config | `DescribeCluster` | `version === config.eks.version`                                      |
| Auto Mode is enabled              | `DescribeCluster` | `computeConfig.enabled === true`                                      |
| Authentication mode is API        | `DescribeCluster` | `accessConfig.authenticationMode === 'API'`                           |
| Endpoint is private-only          | `DescribeCluster` | `endpointPrivateAccess === true`, `endpointPublicAccess === false`    |
| Control-plane logs enabled        | `DescribeCluster` | All 5 log types present in `logging.clusterLogging`                   |
| Secrets encryption uses KMS       | `DescribeCluster` | `encryptionConfig` references a KMS key with `resources: ['secrets']` |

#### Security Verification (`security.e2e.spec.ts`)

Uses AWS SDK (`@aws-sdk/client-kms`, `@aws-sdk/client-iam`, `@aws-sdk/client-ec2`):

| Check                                           | API                                   | Assertion                                   |
| ----------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| KMS key exists and rotation enabled             | `DescribeKey`, `GetKeyRotationStatus` | `keyState === 'Enabled'`, rotation is on    |
| KMS alias matches `alias/<cluster>-eks-secrets` | `ListAliases`                         | Alias exists and points to correct key      |
| Cluster security group egress rules             | `DescribeSecurityGroupRules`          | Egress CIDRs match configured allowlist     |
| OIDC provider exists                            | `ListOpenIDConnectProviders`          | Provider ARN present for cluster issuer URL |
| IAM roles follow least-privilege                | `GetRolePolicy`                       | `iam:PassRole` scoped to `*-eks-addon-*`    |

#### Namespace Verification (`namespaces.e2e.spec.ts`)

Uses `@kubernetes/client-node` or `kubectl` to query the live cluster:

| Check                                      | API                           | Assertion                                                 |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------- |
| All configured namespaces exist            | `listNamespace`               | Each namespace in config exists                           |
| PSA labels applied                         | `readNamespace`               | `enforce=baseline`, `warn=restricted`, `audit=restricted` |
| Default-deny egress policy exists          | `listNamespacedNetworkPolicy` | Policy with empty egress array present                    |
| DNS egress policy exists                   | `listNamespacedNetworkPolicy` | Policy allowing UDP/TCP 53 to kube-dns                    |
| K8s API egress policy exists               | `listNamespacedNetworkPolicy` | Policy allowing TCP 443 to API server                     |
| Proxy egress policy exists (proxy clients) | `listNamespacedNetworkPolicy` | Policy allowing TCP to egress-proxy on port 3128          |

#### ARC Controller Verification (`arc-controller.e2e.spec.ts`)

| Check                                          | API                                     | Assertion                                                                                                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARC controller pod is Running                  | `listNamespacedPod` in `arc-system`     | At least 1 pod with `status.phase === 'Running'`                                                                                                                                                                                               |
| ARC Helm release is deployed                   | `helm list -n arc-system` or K8s Secret | Release exists with status `deployed`                                                                                                                                                                                                          |
| GitHub auth secret exists in runner namespaces | `readNamespacedSecret`                  | Token broker mode: `arc-github-auth` secret present with `github_token` key (`ghs_*` installation token). Legacy mode: `arc-github-auth` secret present with `github_app_id`, `github_app_installation_id`, and `github_app_private_key` keys. |

#### Workload Identity Verification (`workload-identity.e2e.spec.ts`)

| Check                                   | API                            | Assertion                                             |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| Service accounts have IRSA annotation   | `readNamespacedServiceAccount` | `eks.amazonaws.com/role-arn` annotation present       |
| IAM role trust policy scopes correct SA | `GetRole`                      | Trust policy conditions include exact `sub` and `aud` |

### 13.3 Test Infrastructure

```typescript
// tests/setup.ts - shared test utilities
import { EKSClient, DescribeClusterCommand } from '@aws-sdk/client-eks';
import { KMSClient } from '@aws-sdk/client-kms';
import { IAMClient } from '@aws-sdk/client-iam';
import * as k8s from '@kubernetes/client-node';

export function createEksClient(region = 'us-east-1'): EKSClient {
    return new EKSClient({ region });
}

export function createKubeConfig(clusterName: string): k8s.KubeConfig {
    // Load kubeconfig from eksctl or environment
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    return kc;
}

export function loadTestConfig(env: string): DefaultConfig {
    // Load the same config the deployment uses
    return ConfigLoader.loadConfig<DefaultConfig>(config, env);
}
```

### 13.4 Running Integration Tests

```bash
# Retrieve kubeconfig for target cluster
eksctl utils write-kubeconfig --cluster <cluster-name> --region us-east-1

# Run integration tests against dev
npm run test:e2e

# Run a specific test suite
npx jest --config tests/jest-e2e.json tests/e2e/eks-cluster.e2e.spec.ts
```

Integration tests use longer timeouts (`30s` per test) and run sequentially to avoid API rate limiting. They are intended to run **after each deployment** as part of the acceptance checklist and in CI/CD pipelines.

### 13.5 Test-to-Requirement Traceability

| Test File                       | Requirements Verified                              |
| ------------------------------- | -------------------------------------------------- |
| `eks-cluster.e2e.spec.ts`       | REQ-EKS-001 through 009                            |
| `security.e2e.spec.ts`          | REQ-SEC-001 through 004, REQ-SEC-009, REQ-SEC-010  |
| `namespaces.e2e.spec.ts`        | REQ-K8S-001, REQ-K8S-004, REQ-HARD-001 through 003 |
| `arc-controller.e2e.spec.ts`    | REQ-ARC-001 through 004, REQ-AUTH-001 through 004  |
| `arc-runners.e2e.spec.ts`       | REQ-ARC-005 through 011, REQ-RUN-001 through 005   |
| `proxy.e2e.spec.ts`             | REQ-PROXY-001 through 007                          |
| `observability.e2e.spec.ts`     | REQ-OBS-001 through 006                            |
| `workload-identity.e2e.spec.ts` | REQ-SEC-005 through 007                            |
