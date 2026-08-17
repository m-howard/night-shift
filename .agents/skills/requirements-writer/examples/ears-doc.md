# GitHub EKS Runners Requirements (EARS, Pre-Start Baseline)

## Scope

This document defines the target requirements for the GitHub EKS Runners platform as a greenfield project. All requirements are written as desired end-state behavior and do not imply current implementation.

## EARS Legend

| Type              | Pattern                                                |
| ----------------- | ------------------------------------------------------ |
| Ubiquitous        | The `<system>` shall ...                               |
| Event-driven      | When `<trigger>`, the `<system>` shall ...             |
| State-driven      | While `<state>`, the `<system>` shall ...              |
| Optional feature  | Where `<feature is enabled>`, the `<system>` shall ... |
| Unwanted behavior | If `<condition>`, then the `<system>` shall ...        |

## Requirement Catalog

### Delivery Workflow and Validation

| ID          | Type              | Requirement                                                                                                                                                    |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-DLV-001 | Ubiquitous        | The delivery workflow shall represent each meaningful change as a Jira issue with required fields for summary, type, priority, owner, and acceptance criteria. |
| REQ-DLV-002 | Event-driven      | When implementation starts, the delivery workflow shall transition the Jira issue from `To Do` to `In Progress`.                                               |
| REQ-DLV-003 | Event-driven      | When validation is complete, the delivery workflow shall transition the Jira issue to `Done` and record completion evidence.                                   |
| REQ-DLV-004 | State-driven      | While an issue includes infrastructure changes, the delivery workflow shall require successful `npm run deploy:dev` before transitioning the issue to `Done`.  |
| REQ-DLV-005 | Unwanted behavior | If `npm run deploy:dev` fails due expired AWS STS credentials, then the delivery workflow shall run `./scripts/aws_login.sh dev` and retry deployment.         |
| REQ-DLV-006 | Ubiquitous        | The validation gate shall run `npm run lint`, `npm run format`, and `npm run build` for implementation issues.                                                 |
| REQ-DLV-007 | Optional feature  | Where issues do not share files or state, the delivery workflow shall allow parallel execution.                                                                |
| REQ-DLV-008 | State-driven      | While issues modify shared infrastructure primitives, the delivery workflow shall enforce serial execution and merge ordering.                                 |
| REQ-DLV-009 | Ubiquitous        | The project shall maintain dependency-driven execution using Jira issue links (`blocks` and `is blocked by`).                                                  |
| REQ-DLV-010 | Ubiquitous        | The delivery workflow shall store validation evidence, deployment outcomes, and follow-up actions in Jira issue comments or linked artifacts.                  |

### Jira Skills and Official CLI

| ID           | Type         | Requirement                                                                                                                          |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-JIRA-001 | Ubiquitous   | The project shall execute Jira issue operations through the official Jira CLI configured for the organization.                       |
| REQ-JIRA-002 | Event-driven | When creating delivery work, the workflow shall create a Jira issue using the official Jira CLI rather than filesystem task files.   |
| REQ-JIRA-003 | Event-driven | When issue state changes are required, the workflow shall perform transitions using official Jira CLI commands.                      |
| REQ-JIRA-004 | Event-driven | When validation or deployment evidence is produced, the workflow shall publish evidence to the Jira issue via the official Jira CLI. |
| REQ-JIRA-005 | Ubiquitous   | The project shall use Jira skills that wrap and standardize official Jira CLI usage for issue creation, updates, and transitions.    |

### Stack Contract and Config Parsing

| ID           | Type              | Requirement                                                                                                                                  |
| ------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-CONF-001 | Ubiquitous        | The stack contract shall require existing VPC and private subnet inputs for platform deployment.                                             |
| REQ-CONF-002 | Unwanted behavior | If required VPC/subnet inputs are missing or invalid, then the stack parser shall fail fast with actionable validation errors.               |
| REQ-CONF-003 | Ubiquitous        | The stack contract shall support typed environment and tag inputs for consistent resource tagging.                                           |
| REQ-CONF-004 | Optional feature  | Where public subnet IDs are supplied, the stack contract shall treat them as optional inputs without creating new network foundations.       |
| REQ-CONF-005 | Ubiquitous        | The program shall separate config readers, defaults, and validation into `src/program/*` modules.                                            |
| REQ-CONF-006 | Ubiquitous        | The modularized config layer shall preserve stack contract semantics and deterministic defaulting behavior.                                  |
| REQ-CONF-007 | Ubiquitous        | The modularized config layer shall include focused unit tests for parser, defaulting, and validation behavior.                               |
| REQ-CONF-008 | Ubiquitous        | The deployment entrypoint shall delegate orchestration via `src/program/run.ts`, `deploy.ts`, and `outputs.ts` while preserving output keys. |
| REQ-CONF-009 | Ubiquitous        | Documentation shall define a soft maintainability guardrail of approximately 250 lines per source module.                                    |

### EKS Cluster and Networking Baseline

| ID          | Type             | Requirement                                                                                                                                                              |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-EKS-001 | Ubiquitous       | The platform shall provision EKS using a reusable EKS Auto Mode component.                                                                                               |
| REQ-EKS-002 | Ubiquitous       | The EKS cluster shall target private subnets for worker placement.                                                                                                       |
| REQ-EKS-003 | Ubiquitous       | The EKS cluster shall set authentication mode to `API` for Auto Mode compatibility.                                                                                      |
| REQ-EKS-004 | Ubiquitous       | The EKS API endpoint posture shall default to private-only (`endpointPrivateAccess=true`, `endpointPublicAccess=false`).                                                 |
| REQ-EKS-005 | Optional feature | Where public endpoint access is intentionally enabled, the platform shall constrain source CIDRs through `publicAccessCidrs`.                                            |
| REQ-EKS-006 | Ubiquitous       | The cluster shall enable control-plane logs for `api`, `audit`, `authenticator`, `controllerManager`, and `scheduler`.                                                   |
| REQ-EKS-007 | Ubiquitous       | The platform shall export kubeconfig and core cluster outputs for downstream component composition.                                                                      |
| REQ-EKS-008 | Ubiquitous       | The platform shall provide configurable control-plane ingress allowlists via `controlPlaneIngressCidrs`.                                                                 |
| REQ-EKS-009 | Ubiquitous       | The platform shall explicitly manage cluster security group egress for HTTPS and DNS with configurable CIDRs.                                                            |
| REQ-EKS-010 | State-driven     | While private endpoint mode is enabled, the platform shall require NAT or VPC interface endpoint paths and Route 53 resolver reachability for required outbound traffic. |

### Security, IAM, Encryption, and IRSA

| ID          | Type       | Requirement                                                                                                                           |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-SEC-001 | Ubiquitous | The security baseline shall create customer-managed least-privilege IAM policies for cluster operations and add-on management.        |
| REQ-SEC-002 | Ubiquitous | The add-on management policy shall restrict `iam:PassRole` to `*-eks-addon-*` roles and `iam:PassedToService` to `eks.amazonaws.com`. |
| REQ-SEC-003 | Ubiquitous | The cluster shall enable Kubernetes secret encryption using a customer-managed KMS key and alias `alias/<cluster-name>-eks-secrets`.  |
| REQ-SEC-004 | Ubiquitous | The EKS KMS encryption key shall have rotation enabled.                                                                               |
| REQ-SEC-005 | Ubiquitous | Security resources shall include security-baseline tags for least privilege and data protection.                                      |
| REQ-SEC-006 | Ubiquitous | The platform shall provision separate IRSA roles for ARC controller and Kaniko builder service accounts.                              |
| REQ-SEC-007 | Ubiquitous | IRSA trust policies shall scope exact `sub` and `aud` claims for each Kubernetes service account.                                     |
| REQ-SEC-008 | Ubiquitous | The Kaniko ECR policy shall scope repository actions and include `ecr:GetAuthorizationToken` on `*`.                                  |
| REQ-SEC-009 | Ubiquitous | Kubernetes service accounts used for workload identity shall include `eks.amazonaws.com/role-arn` annotations.                        |

### Kubernetes Foundation and Namespace Bootstrap

| ID          | Type             | Requirement                                                                                                                                   |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-K8S-001 | Ubiquitous       | The platform shall create a shared Kubernetes provider from EKS kubeconfig outputs.                                                           |
| REQ-K8S-002 | Ubiquitous       | The platform shall bootstrap foundational namespaces including `arc-system`, `arc-runners`, `ci-build`, and `policy-system`.                  |
| REQ-K8S-003 | Optional feature | Where workload namespaces are inferred from runner or build templates, the platform shall create those namespaces before dependent resources. |
| REQ-K8S-004 | Ubiquitous       | The platform shall export Kubernetes provider and foundational namespace outputs for downstream components.                                   |

### ARC Controller and Runner Scale Sets

| ID          | Type              | Requirement                                                                                                                                    |
| ----------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-ARC-001 | Optional feature  | Where `deployArc=true`, the platform shall install ARC via a reusable Pulumi component and Helm release.                                       |
| REQ-ARC-002 | Event-driven      | When `deployArc=true`, the platform shall require GitHub organization configuration.                                                           |
| REQ-ARC-003 | Ubiquitous        | ARC configuration shall support namespace, service account, release name, and chart version overrides.                                         |
| REQ-ARC-004 | Ubiquitous        | ARC authentication shall use Kubernetes secret contract keys `github_app_id`, `github_app_installation_id`, and `github_app_private_key`.      |
| REQ-ARC-005 | Optional feature  | Where `deployArcRunnerScaleSets=true`, the platform shall deploy one or more ARC runner scale sets from class definitions.                     |
| REQ-ARC-006 | Unwanted behavior | If `deployArcRunnerScaleSets=true` while ARC is not deployed, then the platform shall block invalid runner-scale-set deployment configuration. |
| REQ-ARC-007 | Ubiquitous        | Runner class definitions shall support configurable labels, min/max runners, resource requests/limits, and node selector overrides.            |
| REQ-ARC-008 | Ubiquitous        | Default runner placement shall target EKS Auto Mode Linux `amd64` nodes.                                                                       |
| REQ-ARC-009 | Ubiquitous        | The default runner label contract shall be exactly `copilot-coding-agent-beta`.                                                                |
| REQ-ARC-010 | Ubiquitous        | Project documentation and examples shall define Copilot runner usage as `runs-on: [copilot-coding-agent-beta]`.                                |

### Proxy-First Egress and ARC Proxy Wiring

| ID            | Type             | Requirement                                                                                                                                                          |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-PROXY-001 | Optional feature | Where `deploySquidProxy=true`, the platform shall deploy in-cluster Squid proxy resources (ConfigMap, Deployment, Service) in `egress-proxy`.                        |
| REQ-PROXY-002 | Ubiquitous       | The Squid deployment shall default to two replicas with a ClusterIP service and configurable service name/port.                                                      |
| REQ-PROXY-003 | Ubiquitous       | The platform shall export Squid endpoint outputs for downstream ARC wiring.                                                                                          |
| REQ-PROXY-004 | Optional feature | Where `enableArcProxyEnv=true`, the platform shall inject `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` into ARC controller and runner templates.                      |
| REQ-PROXY-005 | Ubiquitous       | The default `NO_PROXY` set shall include Kubernetes internal domains and service names needed for cluster-local traffic.                                             |
| REQ-PROXY-006 | Optional feature | Where explicit `arcProxyHttpUrl`, `arcProxyHttpsUrl`, or `arcProxyNoProxy` overrides are provided, the platform shall apply those values instead of Squid defaults.  |
| REQ-PROXY-007 | Event-driven     | When proxy mode is enabled, operators shall validate ARC env wiring and Squid runtime health using runbook commands and evidence.                                    |
| REQ-PROXY-008 | State-driven     | While proxy-first mode is active, operators shall triage proxy failures (`407`, timeouts, connection refused, TLS internal DNS issues) using documented diagnostics. |
| REQ-PROXY-009 | Event-driven     | When final readiness validation is executed, the project shall collect timestamped proxy-path runtime evidence before rollout completion.                            |

### ARC Auth Secret Sync

| ID           | Type              | Requirement                                                                                                                                                                        |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-AUTH-001 | Optional feature  | Where ARC secret sync inputs are configured, the platform shall materialize `arc-github-auth` secrets into required runner namespaces from Secrets Manager or stack-config values. |
| REQ-AUTH-002 | Ubiquitous        | The synced ARC auth secret shall include `github_app_id`, `github_app_installation_id`, and `github_app_private_key` keys.                                                         |
| REQ-AUTH-003 | Unwanted behavior | If any required ARC secret key is missing or empty, then readiness validation shall fail and remediation shall be required before runner reconciliation sign-off.                  |
| REQ-AUTH-004 | Ubiquitous        | The ARC auth secret name shall be configurable and default to `arc-github-auth`.                                                                                                   |
| REQ-AUTH-005 | Ubiquitous        | The platform shall expose outputs showing whether secret sync is enabled and which namespaces were synchronized.                                                                   |

### Kaniko Build Plane

| ID             | Type             | Requirement                                                                                                                                |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-KANIKO-001 | Optional feature | Where `deployKanikoBuildPlane=true`, the platform shall create reusable, suspended Kaniko `CronJob` templates for in-cluster builds.       |
| REQ-KANIKO-002 | Ubiquitous       | Kaniko template definitions shall support destination, context, dockerfile, build args, extra args, node selectors, and resource settings. |
| REQ-KANIKO-003 | Optional feature | Where Kaniko cache is enabled, the platform shall support configurable cache repository, cache TTL, and compression behavior.              |
| REQ-KANIKO-004 | Ubiquitous       | Kaniko workloads shall run with IRSA-backed service accounts for ECR authentication and image push/pull.                                   |

### Observability and Incident Response

| ID          | Type             | Requirement                                                                                                               |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| REQ-OBS-001 | Optional feature | Where `deployObservability=true`, the platform shall deploy EKS observability resources for runner/build operations.      |
| REQ-OBS-002 | Optional feature | Where `deployContainerInsightsAddon=true`, the platform shall enable the `amazon-cloudwatch-observability` add-on.        |
| REQ-OBS-003 | Ubiquitous       | The platform shall create alarms for pod failures, pending pods, and failed cluster nodes across target namespaces.       |
| REQ-OBS-004 | Optional feature | Where an alarm SNS topic ARN is configured, CloudWatch alarms shall target that notification destination.                 |
| REQ-OBS-005 | Ubiquitous       | The platform shall export observability outputs including alarm names, alarm ARNs, and runbook URL.                       |
| REQ-OBS-006 | Event-driven     | When an observability alarm is triggered, operators shall follow alarm-to-runbook mappings and capture incident evidence. |

### Workload Hardening and Policy Controls

| ID           | Type             | Requirement                                                                                                                        |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| REQ-HARD-001 | Optional feature | Where workload hardening is enabled, the platform shall apply Pod Security Admission labels to workload namespaces.                |
| REQ-HARD-002 | Ubiquitous       | The default Pod Security profile shall use `enforce=baseline` and `warn/audit=restricted` unless stricter levels are configured.   |
| REQ-HARD-003 | Ubiquitous       | The platform shall enforce default-deny namespace network policy plus allow-same-namespace, allow-dns, and allow-https exceptions. |
| REQ-HARD-004 | Optional feature | Where `allowedEgressCidrs` is configured, the platform shall scope HTTPS egress network policy to those CIDRs.                     |
| REQ-HARD-005 | Ubiquitous       | Policy exceptions shall remain minimal and explicitly documented.                                                                  |

### CrowdStrike Falcon Sensor

| ID         | Type             | Requirement                                                                                                                                    |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-CS-001 | Optional feature | Where `deployCrowdstrikeFalconSensor=true`, the platform shall deploy CrowdStrike using the supported `falcon-sensor` Helm chart.              |
| REQ-CS-002 | Ubiquitous       | The platform shall not deploy deprecated `cs-k8s-protection-agent` artifacts.                                                                  |
| REQ-CS-003 | Event-driven     | When CrowdStrike deployment is enabled, the platform shall validate required credential inputs from environment variables or stack references. |
| REQ-CS-004 | Optional feature | Where a 32-character CID is provided without suffix, the platform shall normalize it with a configurable suffix defaulting to `9B`.            |

### Documentation, Debugging, and Acceptance Evidence

| ID          | Type         | Requirement                                                                                                                                                                                |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-DOC-001 | Ubiquitous   | The project documentation shall include a Copilot runner contract, kubectl debugging runbook, and acceptance checklist.                                                                    |
| REQ-DOC-002 | Ubiquitous   | The acceptance checklist shall verify private networking, ARC readiness, proxy wiring, security hardening, and observability readiness.                                                    |
| REQ-DOC-003 | Event-driven | When using kubectl for cluster debugging, operators shall retrieve kubeconfig using `eksctl utils write-kubeconfig --cluster <cluster-name> --region us-east-1` before kubectl operations. |
| REQ-DOC-004 | Ubiquitous   | Incident evidence capture shall include resource descriptions, logs, events, alarm context, remediation applied, and verification output.                                                  |
| REQ-DOC-005 | Event-driven | When end-to-end readiness validation runs, the project shall record timestamped command evidence and pass/fail outcomes per acceptance item.                                               |
