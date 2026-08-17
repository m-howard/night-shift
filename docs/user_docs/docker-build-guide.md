# Docker Build Guide

This guide shows how to build and push container images from GitHub Actions jobs on the managed runner platform.

## Before You Start

- Use one of these labels: `linux`, `linux-arm64`, or `copilot-coding-agent`.
- Configure AWS credentials in the workflow before you push to Amazon ECR.
- Keep the build context small with a `.dockerignore` file or a subdirectory build context.

## What the Platform Provides

During image-build jobs, the runner already includes:

- `BUILDKIT_HOST` for the remote BuildKit endpoint
- `BUILDKIT_CACHE_REGISTRY` for the shared registry cache

You do not need to start a Docker daemon in the job. Use `docker buildx` with the remote builder instead.

## Reference Workflow: Build and Push to ECR

```yaml
name: Build Image

on:
    push:
        branches: [main]

permissions:
    contents: read
    id-token: write

env:
    AWS_REGION: us-east-1
    ECR_REGISTRY: 123456789012.dkr.ecr.us-east-1.amazonaws.com
    ECR_REPOSITORY: my-app

jobs:
    build-and-push:
        runs-on: [linux]
        timeout-minutes: 90

        steps:
            - uses: actions/checkout@v4

            - uses: aws-actions/configure-aws-credentials@v4
              with:
                  aws-region: ${{ env.AWS_REGION }}
                  role-to-assume: arn:aws:iam::123456789012:role/my-ecr-push-role

            - name: Log in to ECR
              run: |
                  aws ecr get-login-password --region "$AWS_REGION" \
                    | docker login --username AWS --password-stdin "$ECR_REGISTRY"

            - name: Set up remote buildx
              run: |
                  docker buildx create \
                    --name runner-buildkit \
                    --driver remote \
                    "$BUILDKIT_HOST" \
                    --use

            - name: Build and push
              run: |
                  IMAGE_TAG="${ECR_REGISTRY}/${ECR_REPOSITORY}:${GITHUB_SHA::8}"
                  CACHE_REF="${BUILDKIT_CACHE_REGISTRY}:cache-${ECR_REPOSITORY}"

                  docker buildx build \
                    --platform linux/amd64 \
                    --tag "$IMAGE_TAG" \
                    --cache-from "type=registry,ref=${CACHE_REF}" \
                    --cache-to "type=registry,ref=${CACHE_REF},mode=max,image-manifest=true,oci-mediatypes=true" \
                    --push \
                    .
```

### arm64 Builds

For arm64 output:

- switch the job label to `linux-arm64`
- change `--platform linux/amd64` to `--platform linux/arm64`

## Cache Behavior

- The first build for a new image or cache tag is usually the slowest.
- Reuse a stable cache tag so later builds can hit the cache.
- Keep `--cache-from` and `--cache-to` pointed at the same cache reference.

Example stable cache tag:

```bash
CACHE_REF="${BUILDKIT_CACHE_REGISTRY}:cache-${ECR_REPOSITORY}"
```

## Keep Build Size Under Control

- Use `.dockerignore` to exclude files the image does not need.
- Build from a service subdirectory instead of the repository root when possible.
- Split very large builds into smaller images or stages.

Example subdirectory build:

```yaml
- name: Build service image
  run: |
      docker buildx build \
        --file services/my-app/Dockerfile \
        --push \
        --tag "$IMAGE_TAG" \
        services/my-app
```

## Common Problems

| Problem | What to check |
| --- | --- |
| `cannot connect to the Docker daemon` | Confirm the workflow created a remote buildx builder with `"$BUILDKIT_HOST"` before `docker buildx build`. |
| `no basic auth credentials` | Confirm the workflow configured AWS credentials and ran the ECR login step before the push. |
| `403` or proxy tunnel error during image pull or dependency install | Note the blocked hostname from the log and request outbound access using [Runner Access and Label Requests](runner-label-request.md). |
| `ephemeral-storage limit exceeded` | Reduce the build context, use `.dockerignore`, or request a label with more storage. |
| Cache never seems to hit | Confirm `--cache-from` and `--cache-to` use the same cache reference and do not change on every commit. |

## Related Pages

- [Developer Quickstart](quickstart.md)
- [Runner Label Catalog](runner-label-catalog.md)
- [Networking and External Access](networking-proxy-guide.md)
- [Troubleshooting Guide](troubleshooting.md)
