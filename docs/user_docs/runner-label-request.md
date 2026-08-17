# Runner Access and Label Requests

Use this page when your repository needs access to the platform or when the current labels do not meet your workflow needs.

## When to Submit a Request

Submit a request when:

- a new repository needs access to the runner platform
- the existing labels do not provide enough runtime, storage, or concurrency
- you need arm64 support and the workflow cannot use the current arm64 label
- you need a coding-agent label in a target environment
- a workflow needs outbound access to a registry or hostname that is not currently available

Before you request a new label, check [Runner Label Catalog](runner-label-catalog.md). Most CI, Docker build, and coding-agent workflows fit one of the existing labels.

## What to Include

Include the following in the request:

- repository name and workflow file
- target environment or environments
- the label you tried, if any
- what the workflow is doing
- why the current labels are not enough
- expected runtime, storage, and concurrency needs
- whether the workflow builds container images
- whether the workflow needs access to a private registry or external hostname
- the exact error line or queue symptom from the failed run

## Where to Send It

- Email `btp@modernatx.com`
- Or open a repository issue and include the same details

## What Happens Next

1. The platform team reviews the request and confirms whether an existing label already fits.
2. If the request needs a change, the team may ask follow-up questions about runtime, storage, or outbound access.
3. Changes are usually validated in a non-production environment first.
4. After validation succeeds, the change is rolled out to the requested environment.

Simple repository access requests usually move faster than requests for new capacity or new outbound access.

## Before You Open a Request

- Try the closest existing label from [Runner Label Catalog](runner-label-catalog.md).
- If the issue is specific to image builds, check [Docker Build Guide](docker-build-guide.md).
- If the issue looks like blocked network access, check [Networking and External Access](networking-proxy-guide.md).
- If you are not sure whether the problem is label choice or a platform failure, start with [Troubleshooting Guide](troubleshooting.md).
