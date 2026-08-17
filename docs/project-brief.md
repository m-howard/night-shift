# Project Brief: GitHub Actions Self-Hosted Runners on EKS

## 1) Problem Statement

### Pain

The organization requires self-hosted GitHub Actions runners, but there is no standardized, reusable platform that supports secure, scalable runner execution for both CI workloads and GitHub coding agent workloads.

### Context

Current and future workloads must run inside AWS private networking constraints, with separate `dev` and `prd` environments. The platform must be infrastructure-as-code driven, reusable across teams, and operable with predictable scaling behavior.

### Affected Users

Platform engineering teams, application teams using GitHub Actions, and developers using GitHub Actions and GitHub Coding agents are affected by the lack of a consistent runner platform and clear usage guidance.

## 2) Solution Statement

### Core Approach

Build a reusable Pulumi + TypeScript infrastructure platform that runs GitHub Actions self-hosted runners on EKS, integrated into an existing AWS VPC that already provides public, private, and non-routable internal subnets.

### Value Delivered

Teams get a secure, organization-standard runner platform with environment isolation (`dev` and `prd`), autoscaling through Actions Runner Controller (ARC), controlled outbound access through an egress proxy, support for multiple runner compute profiles via labels, and published user guides for onboarding and correct label usage.

### Scope Boundaries

In scope:

- EKS-based runner platform (with AutoMode enabled) for GitHub organization workloads.
- Reusable IaC modules in Pulumi/TypeScript.
- Environment support for `dev` and `prd`.
- ARC-driven autoscaling.
- Egress proxy integration.
- Labeled runner classes for different compute types.
- Support for CI and GitHub coding agent workloads.
- Creation and publication of end-user guides for runner labels and pipeline usage.

Out of scope:

- Migration of existing application pipelines.
- Redesign of the pre-existing AWS VPC.
- Non-GitHub CI tooling integrations.
- Cost optimization beyond baseline tagging/visibility and right-sized runner classes.

## 3) Non-Goals

- Building a general-purpose Kubernetes platform unrelated to GitHub runners.
- Replacing organization-wide identity, SSO, or enterprise access controls.
- Creating a custom autoscaler outside ARC unless a gap is proven.
- Supporting unmanaged/manual runner provisioning workflows.

## 4) Current Pain Points

- No reusable standard for self-hosted runners across teams.
- Risk of inconsistent security controls when teams implement ad hoc runners.
- Difficulty mapping jobs to right-sized compute without labeled runner classes.
- Lack of a shared approach for CI and coding-agent runtime on one platform.
- Potential egress risk without a centralized proxy path.
- Lack of user-facing guidance on available labels and usage patterns.

## 5) Designed Outcomes

- Teams can target organization-managed self-hosted runner labels in pipelines.
- Runner capacity scales automatically according to queued/active workload demand.
- `dev` and `prd` environments deploy consistently from the same IaC patterns.
- Outbound traffic follows approved egress proxy patterns.
- Platform supports both CI jobs and GitHub coding agent workloads.
- End users have clear, published user guides for label selection and pipeline integration.

## Assumptions

- EKS is the Kubernetes runtime platform in AWS.
- Workloads operate within an AWS private network model already in place.
- Existing VPC networking and subnet strategy remain authoritative.
- GitHub organization policy allows only self-hosted runner execution.

## Constraints

- Must use Pulumi and TypeScript.
- Must be reusable infrastructure-as-code.
- Must support `dev` and `prd` lifecycle and deployment patterns.
- Must include autoscaling and controlled egress.

## Related Documents

- Functional requirements: `docs/requirements.md`
