# Developer Quickstart

This guide gets a repository running on the managed GitHub Actions runner platform. Use it to pick a label, copy a workflow, and confirm your first job runs successfully.

## Before You Start

- Your repository must have access to the runner platform. If a new repository never leaves `Queued`, contact `btp@modernatx.com` with the `org/repo` name and the label you are trying to use.
- The base labels such as `linux`, `linux-arm64`, and `copilot-coding-agent` are the stable default choices.
- Labels with a `-dev` suffix are release-candidate runners that may include new features ahead of the stable track.
- Use `-dev` labels only when you want to try the latest runner changes and can tolerate some instability. Do not use them for critical or production workloads.
- Use one platform label per job. Do not combine multiple platform labels in the same `runs-on` list.

## Choose a Label

| Workload | Stable label | Release-candidate label |
| --- | --- | --- |
| Standard CI, scripting, amd64 Docker builds | `linux` | `linux-dev` |
| arm64 validation or arm64 Docker builds | `linux-arm64` | `linux-arm64-dev` |
| Long-running Copilot coding-agent sessions | `copilot-coding-agent` | `copilot-coding-agent-dev` |

If you are unsure, start with the stable label.

## Run Your First CI Job

Use this workflow as a starting point for a standard Node.js job:

```yaml
name: CI

on:
    pull_request:
    push:
        branches: [main]

jobs:
    build-and-test:
        runs-on: [linux]
        timeout-minutes: 30

        steps:
            - uses: actions/checkout@v4

            - uses: actions/setup-node@v4
              with:
                  node-version: '20'

            - run: npm ci
            - run: npm run lint
            - run: npm test
```

To try the release-candidate track for the same runner family, replace `linux` with `linux-dev`.

### Expected Result

After the run starts, GitHub Actions should show:

- the exact label you selected in the **Set up job** section
- a short queue while capacity starts, then a transition to **In progress**
- a completed workflow without any self-hosted runner setup on your repository

## Use arm64 When the Job Needs It

Use the arm64 label only when the build output or test target requires arm64:

```yaml
jobs:
    arm64-check:
        runs-on: [linux-arm64]
        timeout-minutes: 90
```

To try the release-candidate track for arm64, use `linux-arm64-dev`.

## Run a Copilot Coding-Agent Job

Use the coding-agent label for long-running autonomous jobs:

```yaml
jobs:
    copilot-agent:
        runs-on: [copilot-coding-agent-dev]
        timeout-minutes: 480
        permissions:
            contents: write
            pull-requests: write

        steps:
            - uses: actions/checkout@v4
            - uses: github/copilot-coding-agent@v1
```

Replace `copilot-coding-agent-dev` with `copilot-coding-agent` when you want the stable track.

## Platform Limits You Should Plan Around

- `linux` and `linux-arm64` jobs can run for up to 90 minutes.
- `copilot-coding-agent` jobs can run for up to 480 minutes.
- All three labels support Docker builds.
- Service containers are not supported on this platform.

## If Your First Run Fails

- Check the exact label in [Runner Label Catalog](runner-label-catalog.md).
- If the job fails during an image build, use [Docker Build Guide](docker-build-guide.md).
- If the job stays queued or fails with a platform-related error, use [Troubleshooting Guide](troubleshooting.md).
- If the repository needs access or the existing labels are not enough, use [Runner Access and Label Requests](runner-label-request.md).
