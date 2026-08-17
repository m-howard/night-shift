# Runner Label Catalog

Use this page to choose the exact `runs-on` label for a workflow. The platform matches jobs by label, so spelling and environment suffixes must be exact.

## Quick Choice

- Use `linux` for most CI, scripting, and amd64 image builds.
- Use `linux-arm64` when the job must run on arm64 or produce arm64 images.
- Use `copilot-coding-agent` for long-running Copilot coding-agent sessions.
- Use the corresponding `-dev` label only when you want the release-candidate runner for that family.

The `-dev` suffix does not mean a non-production workload. It marks a release-candidate runner track with newer features that users can opt into carefully. Examples:

- `linux-dev`
- `linux-arm64-dev`
- `copilot-coding-agent-dev`

## Current Labels

| Label family | Stable label | Release-candidate label | Architecture | CPU | Memory | Storage | Max duration | Max parallel | Best for | Docker builds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Standard Linux | `linux` | `linux-dev` | amd64 | 4 vCPU | 8 Gi | 80 Gi workspace + 80 Gi work volume | 90 minutes | 10 | Standard CI, linting, testing, amd64 builds | Yes |
| ARM64 Linux | `linux-arm64` | `linux-arm64-dev` | arm64 | 4 vCPU | 8 Gi | 80 Gi workspace + 80 Gi work volume | 90 minutes | 10 | arm64 validation and arm64 builds | Yes |
| Coding Agent | `copilot-coding-agent` | `copilot-coding-agent-dev` | amd64 | 4 vCPU | 8 Gi | 40 Gi workspace + 40 Gi work volume | 480 minutes | 4 | Long-running coding-agent jobs | Yes |

## Label Examples

### Standard CI

```yaml
runs-on: [linux]
```

### arm64 Job

```yaml
runs-on: [linux-arm64]
```

### Release-Candidate Coding-Agent Job

```yaml
runs-on: [copilot-coding-agent-dev]
```

## Decision Guide

| If your job needs... | Use this label |
| --- | --- |
| Default Linux CI capacity | `linux` or `linux-dev` |
| arm64 architecture | `linux-arm64` or `linux-arm64-dev` |
| More than 90 minutes for a Copilot-driven session | `copilot-coding-agent` or `copilot-coding-agent-dev` |

## Important Rules

- Use exactly one platform label per job.
- Use the base label by default, especially for critical or production workloads.
- Use the `-dev` label only when you deliberately want the release-candidate track.
- Standard labels stop at 90 minutes. Coding-agent labels stop at 480 minutes.
- If a job needs more time, more storage, more concurrency, or a different label shape, request it instead of inventing a new label in the workflow.

## Common Workload Mapping

| Workload | Recommended label |
| --- | --- |
| Unit tests, linting, scripting | `linux` |
| Container image build for amd64 | `linux` |
| Container image build for arm64 | `linux-arm64` |
| Multi-hour coding-agent task | `copilot-coding-agent` |

Switch to the `-dev` form only if you want the release-candidate runner for that same workload.

## Need Something Different?

Use [Runner Access and Label Requests](runner-label-request.md) if you need:

- access for a new repository
- more disk, duration, or concurrency
- a label that does not exist today
- coding-agent access in an environment where it is not yet enabled
