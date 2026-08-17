# Troubleshooting Guide

Use this page when a workflow fails on the managed runner platform. Start from what you see in GitHub Actions, then collect the evidence support needs if you still need help.

## 1. Job Stays Queued

### What to check

1. Confirm the workflow uses an exact label from [Runner Label Catalog](runner-label-catalog.md).
2. Confirm the label matches the runner track you intended to use:
   - stable: `linux`, `linux-arm64`, `copilot-coding-agent`
   - release-candidate: `linux-dev`, `linux-arm64-dev`, `copilot-coding-agent-dev`
3. Confirm the repository already has access to that label family.
4. Wait a few minutes and refresh the run. A short queue can be normal when capacity is starting.

### When to escalate

Escalate if the job is still queued after you have confirmed the label and repository access.

## 2. Job Uses the Wrong Label

### What to check

Use one platform label per job and keep it exact.

Correct examples:

```yaml
runs-on: [linux]
runs-on: [linux-arm64]
runs-on: [copilot-coding-agent-dev]
```

Incorrect examples:

```yaml
runs-on: [linux, linux-arm64]
runs-on: [copilot-coding-agent-prd]
runs-on: [custom-label-not-in-catalog]
```

If the label is wrong, update the workflow and rerun it.

## 3. ECR Login or Image Push Fails

### Common log patterns

- `no basic auth credentials`
- `denied: requested access to the resource is denied`
- `The security token included in the request is invalid`

### What to check

1. Confirm the workflow configured AWS credentials before the push step.
2. Confirm the workflow logged in to ECR before `docker buildx build --push`.
3. Confirm the target ECR registry and repository values are correct.
4. If the workflow assumes a role, confirm the role ARN is correct for the target environment.

If the credentials step succeeds but the push is still denied, include the exact error line in your escalation.

## 4. `docker buildx` Cannot Start the Build

### Common log patterns

- `cannot connect to the Docker daemon`
- `no builder "runner-buildkit" found`

### What to check

1. Confirm the job uses `linux`, `linux-arm64`, or `copilot-coding-agent`.
2. Confirm the workflow creates a remote buildx builder with `"$BUILDKIT_HOST"` before running `docker buildx build`.
3. Confirm the build command uses the correct `--platform` value for the chosen label.

If the job still fails, include the buildx setup step and the first failing line from the build log.

## 5. Dependency Download or Image Pull Fails with a Network Error

### Common log patterns

- proxy-related `403`
- `Could not resolve host`
- `x509: certificate signed by unknown authority`
- connection timeout while downloading packages or pulling an image

### What to check

1. Identify the exact hostname from the error line.
2. Confirm the hostname is the one you intended to use.
3. If this is a new dependency, use [Networking and External Access](networking-proxy-guide.md) to request access.

When you escalate, include the hostname and the exact error line. Support cannot act on a generic "network failed" description.

## 6. Builds Are Always Slow or Cache Never Hits

### What to check

1. Confirm `--cache-from` and `--cache-to` use the same cache reference.
2. Use a stable cache tag such as `cache-my-service` instead of a cache tag that changes every run.
3. Confirm the build context is not much larger than it needs to be.

If the build is slow because the job downloads large dependencies from new destinations, review [Networking and External Access](networking-proxy-guide.md) as well.

## Escalation Checklist

Before you contact `btp@modernatx.com`, collect:

- the GitHub Actions run URL
- the exact `runs-on` label
- the target environment
- the exact error line from the log
- a short workflow excerpt that shows the relevant job steps
- the hostname or registry involved, if the issue is network- or image-related
- whether the issue is new, intermittent, or a regression

## Related Pages

- [Developer Quickstart](quickstart.md)
- [Runner Label Catalog](runner-label-catalog.md)
- [Docker Build Guide](docker-build-guide.md)
- [Networking and External Access](networking-proxy-guide.md)
- [Runner Access and Label Requests](runner-label-request.md)
