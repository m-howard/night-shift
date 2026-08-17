# Pulumi Software Architecture

This document outlines the complete software architecture design for an infrastructure system using Pulumi Automation API. It provides a modular and layered approach to manage infrastructure in AWS using well-scoped projects, logical separation of responsibilities, and support for environment-specific deployments.

## 🔧 Design Principles

- **Modularity**: Separate infrastructure concerns across clearly defined projects.
- **Least Privilege**: Scope stack permissions and updates to the smallest possible blast radius.
- **Layered Dependency**: Projects are applied in strict top-down order and destroyed bottom-up.
- **Blue/Green Ready**: Application and compute stacks are designed for zero-downtime switchovers.
- **Automation-Friendly**: Driven by Pulumi Automation API for CI/CD orchestration.

## 🗂️ Projects Overview

| Project File    | Purpose                                                      | Scope               |
| --------------- | ------------------------------------------------------------ | ------------------- |
| `foundation`    | Account-wide policies, VPC endpoints, ACM certs              | Global + Per Region |
| `stateful-data` | Data storage systems (e.g. RDS, S3, SQS, SNS, ECR)           | Per Region          |
| `compute`       | Compute infrastructure (e.g. ECS Clusters, ALB, API Gateway) | Per Region          |

---

## 🧱 Stack Dependency Graph

```text
   foundation
    ↙      ↘
stateful-data  compute
```

> Each arrow indicates a dependency via `StackReference` (read-only).

## 🛠️ Automation API Orchestrator

A central `orchestrator` project uses the Pulumi Automation API to:

- Accept CLI arguments (`deploy|preview|destroy`, env, scope, regions)
- Determine rollout order
- Create/select stack for each project-layer
- Refresh, configure, and execute action
- Parallelize independent region stacks

### Rollout Order (Creation)

```ts
['foundation', 'stateful-data', 'compute'];
```

### Stack Naming Convention

```txt
<org>/<project-name>-<layer>/<env>
```

Example: `moderna/github-runners-eks/dev`

## 🧭 Stack Tags

Each stack includes the following tags:

```ts
{
  owner: 'user@modernatx.com',
  department: 'Tooling and Automation',
  environment: 'dev',
  'application-name': 'cicada',
  // ... other standard tags
}
```

## Benefits

- Predictable deployments with minimal drift
- Fast iteration on services, slow change to foundational layers
- Isolated failure domains
- Team-level ownership mapping directly to project folders

## Next Steps

1. Refactor existing projects into the five canonical folders
2. Update Automation API rollout strategy
3. Enforce stack naming and tagging policies
4. Integrate into CI/CD pipelines

---

For questions or enhancements, contact the platform team.
