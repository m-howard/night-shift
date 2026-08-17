# Deploy Runbook

This runbook covers the temporary GitHub Actions path used before ARC runner scale sets are online for an environment.

Use the [`Deploy`](../../.github/workflows/deploy.yml) workflow to run repository validation and Pulumi deployment jobs on a dedicated EC2 self-hosted runner.

---

## When To Use This Workflow

Use this workflow when:

- A new environment has not finished deploying ARC runner scale sets yet
- Standard deployment jobs cannot target `linux`, `linux-arm64`, or `copilot-coding-agent` labels yet
- You need a temporary deploy path to deploy `foundation`, `stateful-data`, or `compute`

Do not use this workflow after the environment-specific ARC runners are healthy. Move normal CI/CD back to the standard runner labels once the platform is online.

---

## Required GitHub Configuration

Create GitHub environments named `dev`, `val`, and `prd`. Store the following configuration in each environment.

### Required environment secrets

| Secret         | Purpose                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `AWS_ROLE_ARN` | IAM role assumed by `aws-actions/configure-aws-credentials` for the selected environment |

### Optional environment or repository variables

| Variable           | Default     | Purpose                                                       |
| ------------------ | ----------- | ------------------------------------------------------------- |
| `AWS_REGION`       | `us-east-1` | AWS region passed to the workflow                             |
| `PULUMI_ORG`       | `moderna`   | Pulumi Cloud organization used for GitHub OIDC token exchange |
| `PULUMI_TEAM_NAME` | None        | Pulumi Cloud team name used to scope the OIDC-minted token    |

The workflow always targets the fixed self-hosted runner label `bootstrap-eks-runner`.

No `PULUMI_ACCESS_TOKEN` secret is required. The workflow uses `pulumi/auth-actions@v1` to exchange the GitHub Actions OIDC token for a short-lived Pulumi Cloud team token scoped by `PULUMI_TEAM_NAME`.

---

## Required Deploy Runner Labels

The temporary EC2 self-hosted runner should register at least these labels:

```text
self-hosted
linux
x64
bootstrap-eks-runner
```

The deploy runner must register the `bootstrap-eks-runner` label for the workflow to dispatch successfully.

---

## Workflow Behavior

The workflow exposes these manual inputs:

| Input           | Purpose                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| `environment`   | Selects the GitHub environment and Pulumi stack environment (`dev`, `val`, or `prd`) |
| `scope`         | Comma-separated Pulumi layers to target                                              |
| `preview_only`  | Runs validation and preview but skips deploy when `true`                             |
| `skip_previews` | Skips stack preview jobs and allows deploy to proceed from validation only           |

Execution order:

1. `Plan Target Stacks` resolves which stacks should run.
   The workflow validates the comma-separated `scope` list and resolves all requested stacks from that input.
2. `Validate Repository` runs once on the deploy runner and executes `npm ci`, `npm run lint`, `npm run format`, and `npm run build`.
3. Unless `skip_previews=true`, preview jobs run one stack at a time in dependency order:
   `foundation` -> `stateful-data` -> `compute`.
   Each requested stack runs its own `npm run preview -- <env> --scope <stack>` command.
4. When `preview_only` is `false`, deploy jobs run one stack at a time in the same order:
   `foundation` -> `stateful-data` -> `compute`.
   Each requested stack runs its own `npm run deploy -- <env> --scope <stack>` command.
   If `skip_previews=true`, deploy jobs require only successful repository validation and prior stack deploy dependencies.

This keeps both validation and deploy paths on the same temporary execution surface until ARC runners are available.

---

## Recommended Usage

Preview only:

```text
environment: dev
scope: foundation,stateful-data,compute
preview_only: true
skip_previews: false
```

Deploy compute only after bootstrap prerequisites are complete:

```text
environment: dev
scope: compute
preview_only: false
skip_previews: false
```

Deploy without previews:

```text
environment: dev
scope: foundation,stateful-data,compute
preview_only: false
skip_previews: true
```

---

## Deploy IAM Role

The workflow assumes the IAM role referenced by `AWS_ROLE_ARN`. For this repository the role is named **`github-runners-eks-deploy`** (account `427222695245`, region `us-east-1`).

The role carries a single inline policy named **`github-runners-eks-deploy-policy`** with the following permission statements. When new AWS resources are added to the Pulumi stacks, this policy must be updated to include any additional actions required by those resources.

| Statement SID                               | Services             | Purpose                                                                                          |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `FoundationAccountSecurityControls`         | `ec2`, `s3`          | EBS encryption defaults and S3 account public access block                                       |
| `KmsCreateKeyForFoundationAndEks`           | `kms`                | Create KMS keys and list aliases                                                                 |
| `KmsManageFoundationAndEksKeys`             | `kms`                | Full lifecycle management of project KMS keys and aliases                                        |
| `StatefulDataEcr`                           | `ecr`                | Full lifecycle management of ECR repositories and image pushes                                   |
| `SecretsManagerCreateProjectSecrets`        | `secretsmanager`     | Create Secrets Manager secrets                                                                   |
| `SecretsManagerManageProjectSecrets`        | `secretsmanager`     | Manage project-scoped secrets                                                                    |
| `IamCreateProjectRolesPoliciesAndProviders` | `iam`                | Create roles, policies, and OIDC providers                                                       |
| `IamManageProjectRolesPoliciesAndProviders` | `iam`                | Full lifecycle management of project roles, policies, and OIDC providers                         |
| `PassOnlyExpectedServiceRoles`              | `iam`                | `iam:PassRole` restricted to EKS, EC2, Lambda, and EKS Pod Identity service principals           |
| `EksClusterAddonsAndAccess`                 | `eks`                | Create and manage EKS clusters, add-ons, and access entries                                      |
| `Ec2VpcAndSecurityGroupManagementForEks`    | `ec2`                | VPC inspection and security group management required by EKS                                     |
| `LambdaAndEventBridgeForProjectResources`   | `lambda`, `events`   | Full CRUD and read lifecycle for Lambda functions and EventBridge rules used by the token broker |
| `CloudWatchAndLogsForObservability`         | `cloudwatch`, `logs` | CloudWatch metric alarms and CloudWatch Logs groups for observability                            |
| `SnsForObservabilityAlarms`                 | `sns`                | Create and manage SNS topics used as alarm notification targets for observability alarms         |

### Adding new AWS permissions

If a deploy job fails with a `403 AccessDenied` error, follow these steps:

1. Identify the missing action from the Pulumi error output (e.g. `cloudwatch:ListTagsForResource`).
2. Determine which existing statement SID the action belongs to, or create a new statement if it covers a new service.
3. Update the inline policy via the AWS Console or CLI:
    ```bash
    AWS_PAGER="" aws iam get-role-policy \
      --role-name github-runners-eks-deploy \
      --policy-name github-runners-eks-deploy-policy
    # Edit the document, then:
    AWS_PAGER="" aws iam put-role-policy \
      --role-name github-runners-eks-deploy \
      --policy-name github-runners-eks-deploy-policy \
      --policy-document file://updated-policy.json
    ```
4. Re-trigger the failed workflow run.

> **Note:** The `aws` Pulumi provider calls `ListTagsForResource` after creating resources in many services (CloudWatch, ECR, etc.) to reconcile tags. Always include the `ListTagsForResource` action alongside `TagResource`/`UntagResource` when adding a new service.

---

## Troubleshooting

| Symptom                                          | Likely cause                                                             | Action                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Job remains queued                               | The runner is not registered with `bootstrap-eks-runner`                 | Verify the EC2 runner labels include `bootstrap-eks-runner`                                                  |
| AWS credential step fails                        | Missing or incorrect `AWS_ROLE_ARN` secret                               | Update the selected GitHub environment secret                                                                |
| Pulumi authentication fails                      | Pulumi Cloud GitHub OIDC issuer, policy, or team scope is not configured | Verify the Pulumi Cloud GitHub OIDC issuer, authorization policy, `PULUMI_ORG`, and `PULUMI_TEAM_NAME` value |
| Preview or deploy fails before compute is online | Missing cloud bootstrap prerequisites                                    | Review [README.md](../../README.md) and complete the temporary bootstrap setup                               |
| Deploy fails with `403 AccessDenied` on AWS API  | Missing IAM action in the deploy role's inline policy                    | See [Adding new AWS permissions](#adding-new-aws-permissions) above                                          |
