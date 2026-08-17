# GitHub EKS Runner Platform Requirements (EARS, Baseline v3)

## Scope

This document defines the baseline requirements for a reusable EKS platform that provides GitHub self-hosted runners for CI and Copilot coding-agent workloads. The platform is the infrastructure foundation and does not include authoring or managing application CI/CD pipelines. Requirements prioritize secure-by-default operations, controlled egress, operational observability, and clear operator and end-user documentation.

## EARS Legend

| Type              | Pattern                                                |
| ----------------- | ------------------------------------------------------ |
| Ubiquitous        | The `<system>` shall ...                               |
| Event-driven      | When `<trigger>`, the `<system>` shall ...             |
| State-driven      | While `<state>`, the `<system>` shall ...              |
| Optional feature  | Where `<feature is enabled>`, the `<system>` shall ... |
| Unwanted behavior | If `<condition>`, then the `<system>` shall ...        |

## Requirement Catalog |

### EKS Cluster and Networking Baseline

| ID          | Type             | Requirement                                                                                                                   |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| REQ-EKS-001 | Ubiquitous       | The platform shall provision EKS using a reusable EKS component with AutoMode enabled.                                        |
| REQ-EKS-002 | Ubiquitous       | The EKS cluster shall target private subnets for worker placement.                                                            |
| REQ-EKS-003 | Ubiquitous       | The EKS cluster shall set authentication mode to `API` for Auto Mode compatibility.                                           |
| REQ-EKS-004 | Ubiquitous       | The EKS API endpoint posture shall default to private-only (`endpointPrivateAccess=true`, `endpointPublicAccess=false`).      |
| REQ-EKS-005 | Optional feature | Where public endpoint access is intentionally enabled, the platform shall constrain source CIDRs through `publicAccessCidrs`. |
| REQ-EKS-006 | Ubiquitous       | The cluster shall enable control-plane logs for `api`, `audit`, `authenticator`, `controllerManager`, and `scheduler`.        |
| REQ-EKS-007 | Ubiquitous       | The platform shall export kubeconfig and core cluster outputs for downstream component composition.                           |
| REQ-EKS-008 | Ubiquitous       | The platform shall provide configurable control-plane ingress allowlists via `controlPlaneIngressCidrs`.                      |
| REQ-EKS-009 | Ubiquitous       | The platform shall explicitly manage cluster security group egress with configurable CIDRs.                                   |

### Security, IAM, Encryption, and IRSA

| ID          | Type              | Requirement                                                                                                                                                   |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-SEC-001 | Ubiquitous        | The security baseline shall create customer-managed least-privilege IAM policies for cluster operations and add-on management.                                |
| REQ-SEC-002 | Ubiquitous        | The add-on management policy shall restrict `iam:PassRole` to `*-eks-addon-*` roles and `iam:PassedToService` to `eks.amazonaws.com`.                         |
| REQ-SEC-003 | Ubiquitous        | The cluster shall enable Kubernetes secret encryption using a customer-managed KMS key and alias `alias/<cluster-name>-eks-secrets`.                          |
| REQ-SEC-004 | Ubiquitous        | The EKS KMS encryption key shall have rotation enabled.                                                                                                       |
| REQ-SEC-005 | Ubiquitous        | The platform shall provision separate IRSA roles for ARC controller service accounts.                                                                         |
| REQ-SEC-006 | Ubiquitous        | IRSA trust policies shall scope exact `sub` and `aud` claims for each Kubernetes service account.                                                             |
| REQ-SEC-007 | Ubiquitous        | Kubernetes service accounts used for workload identity shall include `eks.amazonaws.com/role-arn` annotations.                                                |
| REQ-SEC-008 | Event-driven      | When GitHub App credentials are rotated, the platform shall support zero-downtime secret refresh and validate successful reconciliation.                      |
| REQ-SEC-009 | Ubiquitous        | Runner pods shall run with no AWS permissions by default, and any AWS access shall be explicitly granted through per-runner-class least-privilege IRSA roles. |
| REQ-SEC-010 | Unwanted behavior | If secret material is detected in stack outputs, logs, or state, then validation shall fail and deployment shall be blocked.                                  |

### Kubernetes Foundation and Namespace Bootstrap

| ID          | Type       | Requirement                                                                                                 |
| ----------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| REQ-K8S-001 | Ubiquitous | The platform shall create a shared Kubernetes provider from EKS kubeconfig outputs.                         |
| REQ-K8S-004 | Ubiquitous | The platform shall export Kubernetes provider and foundational namespace outputs for downstream components. |

### ARC Controller and Runner Scale Sets

| ID          | Type              | Requirement                                                                                                                                                                                  |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-ARC-001 | Optional feature  | Where `deployArc=true`, the platform shall install ARC via a reusable Pulumi component and Helm release.                                                                                     |
| REQ-ARC-002 | Event-driven      | When `deployArc=true`, the platform shall require GitHub organization configuration.                                                                                                         |
| REQ-ARC-003 | Ubiquitous        | ARC configuration shall support namespace, service account, release name, and chart version overrides.                                                                                       |
| REQ-ARC-004 | Ubiquitous        | ARC authentication shall use Kubernetes secret contract keys `github_app_id`, `github_app_installation_id`, and `github_app_private_key`.                                                    |
| REQ-ARC-005 | Optional feature  | Where `deployArcRunnerScaleSets=true`, the platform shall deploy one or more ARC runner scale sets from class definitions.                                                                   |
| REQ-ARC-006 | Unwanted behavior | If `deployArcRunnerScaleSets=true` while ARC is not deployed, then the platform shall block invalid runner-scale-set deployment configuration.                                               |
| REQ-ARC-007 | Ubiquitous        | Runner class definitions shall support configurable labels, min/max runners, resource requests/limits, node selector overrides, and per-class egress proxy configuration.                    |
| REQ-ARC-008 | Ubiquitous        | Default runner placement shall target EKS Auto Mode Linux `amd64` nodes.                                                                                                                     |
| REQ-ARC-009 | Ubiquitous        | Each runner class shall expose exactly one unique routing label. Non-production environments shall append `-<env>` to the base label; production (`prd`) shall use the base label unchanged. |
| REQ-ARC-010 | Ubiquitous        | Project documentation and examples shall define Copilot runner usage as `runs-on: [copilot-coding-agent-<env>]` for non-production and `runs-on: [copilot-coding-agent]` for production.     |
| REQ-ARC-011 | Ubiquitous        | The platform shall support Day-1 runner placement for both Linux `amd64` and Linux `arm64` architectures through runner class scheduling controls.                                           |

### Runner Runtime Capabilities

| ID          | Type       | Requirement                                                                                                                                                     |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-RUN-001 | Ubiquitous | The platform shall define and document supported container build mechanisms for runner jobs, including required Kubernetes security posture and storage sizing. |
| REQ-RUN-002 | Ubiquitous | Runner base images shall be versioned, vulnerability-scanned, and patched on a defined cadence, with rollback support.                                          |
| REQ-RUN-003 | Ubiquitous | Runner classes shall support configurable ephemeral-storage requests and limits and, where applicable, node-volume sizing for build workloads.                  |
| REQ-RUN-004 | Ubiquitous | The platform shall define maximum job or session duration per runner class for CI and coding-agent workloads, including eviction and cleanup behavior.          |
| REQ-RUN-005 | Ubiquitous | Runner classes shall declare target CPU architecture (`amd64` or `arm64`) and documentation shall identify architecture-specific labels for workflow selection. |

### Auto Mode Docker Build Compatibility

| ID                | Type              | Requirement                                                                                                                                                                                                                                                        |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-DOCKER-AM-001 | Ubiquitous        | The platform shall support building OCI images on EKS Auto Mode without requiring node SSH or SSM access.                                                                                                                                                          |
| REQ-DOCKER-AM-002 | Ubiquitous        | The platform shall not require host-level Docker daemon configuration or node customization.                                                                                                                                                                       |
| REQ-DOCKER-AM-010 | Ubiquitous        | The platform shall support at least one Day-1 build engine for GitHub Actions image build and push on Auto Mode: rootless BuildKit or Kaniko.                                                                                                                      |
| REQ-DOCKER-AM-011 | Unwanted behavior | If a workflow attempts host Docker socket-mount builds, then the job shall fail fast with guidance to use supported build engines.                                                                                                                                 |
| REQ-DOCKER-AM-020 | Ubiquitous        | The platform shall provide remote caching for container builds and publish a reference workflow demonstrating cache-backed build and push.                                                                                                                         |
| REQ-DOCKER-AM-021 | Ubiquitous        | The platform shall define cache retention and eviction behavior and expected warm-cache rebuild performance characteristics.                                                                                                                                       |
| REQ-DOCKER-AM-030 | Ubiquitous        | The platform shall provide architecture-specific Karpenter NodePools (amd64 `general-purpose`, arm64 `general-purpose-arm64`) with appropriate compute and ephemeral storage. Build runners use resource requests and dedicated namespaces for workload isolation. |
| REQ-DOCKER-AM-031 | Ubiquitous        | The platform shall document supported NodePool configurations, architecture scheduling, and the process for requesting runner class changes.                                                                                                                       |
| REQ-DOCKER-AM-040 | Ubiquitous        | Runner classes shall support configurable ephemeral-storage requests and limits for container builds and shall publish minimum recommended sizing per runner class.                                                                                                |
| REQ-DOCKER-AM-041 | Ubiquitous        | The platform shall define maximum supported build-context size and recommended monorepo strategies, including sparse checkout and context pruning.                                                                                                                 |

### Proxy-First Egress and ARC Proxy Wiring

| ID            | Type              | Requirement                                                                                                                                                                                                        |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-PROXY-001 | Optional feature  | Where `deploySquidProxy=true`, the platform shall deploy in-cluster Squid proxy resources (ConfigMap, Deployment, Service) in `egress-proxy`.                                                                      |
| REQ-PROXY-002 | Ubiquitous        | The Squid deployment shall default to two replicas with a ClusterIP service and configurable service name/port.                                                                                                    |
| REQ-PROXY-003 | Ubiquitous        | The platform shall export Squid endpoint outputs for downstream ARC wiring.                                                                                                                                        |
| REQ-PROXY-004 | Optional feature  | Where `enableArcProxyEnv=true`, the platform shall inject `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` into runner pod templates for runner classes that have not opted out of proxy.                               |
| REQ-PROXY-005 | Ubiquitous        | The default `NO_PROXY` set shall include Kubernetes internal domains and service names needed for cluster-local traffic.                                                                                           |
| REQ-PROXY-006 | Optional feature  | Where explicit `arcProxyHttpUrl`, `arcProxyHttpsUrl`, or `arcProxyNoProxy` overrides are provided, the platform shall apply those values instead of Squid defaults.                                                |
| REQ-PROXY-007 | Ubiquitous        | Proxy configuration shall support explicit domain or IP allowlisting for GitHub and required dependencies, with a documented change and review process.                                                            |
| REQ-PROXY-008 | Optional feature  | Where a runner class sets `egressProxy.enabled=false`, the platform shall omit proxy environment variables from that runner class's pod template and deploy the class into a dedicated direct-egress namespace.    |
| REQ-PROXY-009 | Ubiquitous        | The platform shall apply a `allow-direct-internet-egress` NetworkPolicy (TCP 80/443 to `0.0.0.0/0`) to namespaces hosting non-proxied runner classes in place of the `allow-egress-proxy-egress` NetworkPolicy.    |
| REQ-PROXY-010 | Unwanted behavior | If proxied and non-proxied runner classes are configured in the same Kubernetes namespace, then the platform shall reject the configuration with a validation error before any deployment begins.                  |
| REQ-PROXY-011 | Optional feature  | Where `enableControllerProxyEnv=true`, the platform shall inject proxy environment variables into the ARC controller pod, independently of runner-class proxy configuration.                                       |
| REQ-PROXY-012 | Optional feature  | Where explicit `controllerProxyHttpUrl`, `controllerProxyHttpsUrl`, or `controllerProxyNoProxy` overrides are provided, the platform shall apply those values to the ARC controller instead of the Squid defaults. |

### ARC Auth Secret Sync

| ID           | Type              | Requirement                                                                                                                                                       |
| ------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-AUTH-001 | Optional feature  | Where ARC secret sync inputs are configured, the platform shall materialize `arc-github-auth` secrets into required runner namespaces from Secrets Manager.       |
| REQ-AUTH-002 | Ubiquitous        | The synced ARC auth secret shall include `github_app_id`, `github_app_installation_id`, and `github_app_private_key` keys.                                        |
| REQ-AUTH-003 | Unwanted behavior | If any required ARC secret key is missing or empty, then readiness validation shall fail and remediation shall be required before runner reconciliation sign-off. |
| REQ-AUTH-004 | Ubiquitous        | The ARC auth secret name shall be configurable and default to `arc-github-auth`.                                                                                  |

### Observability and Incident Response

| ID          | Type             | Requirement                                                                                                               |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| REQ-OBS-001 | Optional feature | Where `deployObservability=true`, the platform shall deploy EKS observability resources for runner/build operations.      |
| REQ-OBS-002 | Optional feature | Where `deployContainerInsightsAddon=true`, the platform shall enable the `amazon-cloudwatch-observability` add-on.        |
| REQ-OBS-003 | Ubiquitous       | The platform shall create alarms for pod failures, pending pods, and failed cluster nodes across target namespaces.       |
| REQ-OBS-004 | Optional feature | Where an alarm SNS topic ARN is configured, CloudWatch alarms shall target that notification destination.                 |
| REQ-OBS-005 | Ubiquitous       | The platform shall export observability outputs including alarm names, alarm ARNs, and runbook URL.                       |
| REQ-OBS-006 | Event-driven     | When an observability alarm is triggered, operators shall follow alarm-to-runbook mappings and capture incident evidence. |

### Operations, Upgrades, and Reliability

| ID          | Type       | Requirement                                                                                                                                                                        |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-OPS-001 | Ubiquitous | In `prd`, critical components including ARC controller, proxy, and observability agents shall satisfy HA constraints, including disruption budgets and AZ spread where applicable. |
| REQ-OPS-002 | Ubiquitous | The platform shall define scaling SLOs, including runner startup latency and queued-job thresholds under load, and shall alert when thresholds are breached.                       |

### Workload Hardening and Policy Controls

| ID           | Type             | Requirement                                                                                                                                         |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-HARD-001 | Optional feature | Where workload hardening is enabled, the platform shall apply Pod Security Admission labels to workload namespaces.                                 |
| REQ-HARD-002 | Ubiquitous       | The default Pod Security profile shall use `enforce=baseline` and `warn/audit=restricted` unless stricter levels are configured.                    |
| REQ-HARD-003 | Ubiquitous       | Policy exceptions shall remain minimal and explicitly documented.                                                                                   |
| REQ-HARD-004 | Ubiquitous       | Runner containers shall enforce non-root execution (`runAsNonRoot: true`), deny privilege escalation, and apply a `RuntimeDefault` seccomp profile. |

### CrowdStrike Falcon Sensor

| ID         | Type             | Requirement                                                                                                                       |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| REQ-CS-001 | Optional feature | Where `deployCrowdstrikeFalconSensor=true`, the platform shall deploy CrowdStrike using the supported `falcon-sensor` Helm chart. |

### Documentation, Debugging, and Acceptance Evidence

| ID          | Type              | Requirement                                                                                                                                                                                                                                  |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-DOC-001 | Ubiquitous        | The project documentation shall include a Copilot runner contract, kubectl debugging runbook, and acceptance checklist.                                                                                                                      |
| REQ-DOC-002 | Ubiquitous        | The tests shall verify private networking, ARC readiness, proxy wiring, security hardening, and observability readiness.                                                                                                                     |
| REQ-DOC-003 | Event-driven      | When using kubectl for cluster debugging, operators shall retrieve kubeconfig using `eksctl utils write-kubeconfig --cluster <cluster-name> --region us-east-1` before kubectl operations.                                                   |
| REQ-DOC-004 | Ubiquitous        | Incident evidence capture shall include resource descriptions, logs, events, alarm context, remediation applied, and verification output.                                                                                                    |
| REQ-DOC-005 | Event-driven      | When end-to-end test validation runs, the project shall record timestamped command evidence and pass/fail outcomes per acceptance item.                                                                                                      |
| REQ-DOC-010 | Ubiquitous        | The project documentation shall include a developer Quickstart that enables a repository to run a job on the platform using runner label.                                                                                                    |
| REQ-DOC-011 | Ubiquitous        | The Quickstart shall include copy-and-paste GitHub Actions snippets for both CI jobs and coding-agent jobs.                                                                                                                                  |
| REQ-DOC-020 | Ubiquitous        | Documentation shall provide a runner label catalog listing each supported label or class with CPU, memory, ephemeral storage, architecture, Docker-build support, and restrictions.                                                          |
| REQ-DOC-021 | Ubiquitous        | Documentation shall include a decision guide for selecting runner labels based on workload type, including unit tests, e2e, Docker build, and memory-intensive jobs.                                                                         |
| REQ-DOC-030 | Ubiquitous        | Documentation shall include an Auto Mode Docker build guide covering supported build engines, required workflow configuration, and recommended caching approach.                                                                             |
| REQ-DOC-031 | Ubiquitous        | Documentation shall include at least one reference workflow that builds and pushes an image and shall call out proxy considerations and common failure modes.                                                                                |
| REQ-DOC-040 | Ubiquitous        | Documentation shall include a networking and proxy developer guide with common failure signatures and remediation steps, including proxy authentication, TLS chain, blocked host, and DNS issues.                                            |
| REQ-DOC-041 | Event-driven      | When a proxy restriction blocks a dependency, documentation shall define the allowlisting request process and required reproduction evidence.                                                                                                |
| REQ-DOC-050 | Ubiquitous        | Documentation shall include a supported and unsupported capabilities matrix covering build mode, privileged workloads, service containers, cache behavior, job duration, and disk limits.                                                    |
| REQ-DOC-051 | Ubiquitous        | Documentation shall list default limits, including timeouts, max parallelism per label, max runners, and resource ceilings, and shall define how teams request changes.                                                                      |
| REQ-DOC-060 | Ubiquitous        | Documentation shall include a developer troubleshooting guide for runner pickup failures, stuck queues, label mismatch, auth failures, registry push failures, and cache misses using GitHub logs and published platform dashboards or URLs. |
| REQ-DOC-061 | Ubiquitous        | Documentation shall include a minimal diagnostic-bundle checklist for support tickets including run ID, label, timestamps, and error signature.                                                                                              |
| REQ-DOC-070 | Ubiquitous        | Documentation shall define how teams request a new runner label or class, including required justification, sizing, security implications, expected lead time, and approval path.                                                            |
| REQ-DOC-071 | State-driven      | While a runner label is in beta status, documentation shall define stability expectations and breaking-change policy.                                                                                                                        |
| REQ-DOC-080 | Ubiquitous        | Developer documentation shall be published in a single canonical location and linked from the repository root README and/or internal developer portal.                                                                                       |
| REQ-DOC-081 | Ubiquitous        | Documentation shall include a versioned changelog aligned to platform releases, including label additions, deprecations, and behavior changes.                                                                                               |
| REQ-DOC-082 | Unwanted behavior | If platform behavior changes in a way that impacts workflows, then documentation updates and an announcement note shall be required for release acceptance.                                                                                  |

## Clarifications Needed

None.
