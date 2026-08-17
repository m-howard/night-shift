# Networking and External Access

This guide explains what outbound access usually works from runner jobs, what blocked access looks like in workflow logs, and what information support needs when you request additional access.

## What Usually Works

Most standard CI and image-build workflows can reach the destinations they need without extra setup. Common examples include:

- GitHub and GitHub APIs
- GitHub Container Registry
- Amazon ECR
- AWS STS and the shared npm CodeArtifact repository
- common language package registries such as npm, PyPI, Maven, crates.io, and Go module mirrors
- common Linux package mirrors used during image builds

If your workflow depends on a private registry, an internal package source, or a vendor-specific endpoint outside that common build ecosystem, plan on requesting access.

## What Usually Needs Approval

Request additional access when the workflow needs:

- a private container registry
- an internal API or package mirror
- a vendor endpoint that is not part of the standard build toolchain
- a new download source for base images, install scripts, or binary artifacts

## What Blocked Access Looks Like

| What you see in the workflow log                           | Likely meaning                                                    | What to send support                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `403` after `CONNECT` or another proxy-related `403`       | The destination is not currently approved for outbound access.    | The hostname, the exact error line, the workflow URL, and the runner label.                        |
| `Could not resolve host`                                   | The hostname is wrong or not reachable from the job environment.  | The hostname, the command that failed, and whether it worked before.                               |
| `x509: certificate signed by unknown authority`            | The target uses a certificate chain the job image does not trust. | The target hostname, the full certificate error, and whether this is a public or private endpoint. |
| Connection timeout during dependency install or image pull | The destination is slow, unavailable, or blocked upstream.        | The target hostname, the timeout line, the workflow URL, and when the run happened.                |

## Runner Access Differences

Standard `linux` and `linux-arm64` runners support normal CI and image-build traffic in both `dev` and `prd`. Proxy-aware tools use the platform proxy, and common build tools can reach approved public build sources.

`copilot-coding-agent` runners are more restricted. Use them for coding-agent work, not as a general replacement for CI build runners.

If a workflow works on a standard runner but fails on a coding-agent runner, include both runner labels in the access request.

## Limits That Affect Builds

- Outbound access is limited to approved destinations.
- Large image pulls and package downloads still count toward the job duration limits on your selected label.
- Access changes are not instant. If a new external dependency is required for a release, request it before the workflow change is urgent.

## What to Include in an Access Request

Send the request to `btp@modernatx.com` or include it in a repository issue. Include:

- the exact hostname or registry you need
- why the workflow needs it
- the repository and workflow file
- the runner label and target environment
- the exact error line from the failed run
- whether the access is needed in one environment or all environments
- how often the workflow expects to call that destination

## Tips

- Prefer approved public registries and mirrors when you have a choice.
- Mirror recurring dependencies into an approved registry if your team controls both ends.
- Put dependency downloads early in the job so blocked access fails fast.

## Related Pages

- [Docker Build Guide](docker-build-guide.md)
- [Troubleshooting Guide](troubleshooting.md)
- [Runner Access and Label Requests](runner-label-request.md)
