# Security policy

## Reporting a vulnerability

Report privately through
[GitHub security advisories](https://github.com/m-howard/night-shift/security/advisories/new).
Please do not open a public issue, and please do not include working credentials in the report —
the shape of the problem is what matters.

Expect an acknowledgement within a week. If the report is valid, you will get the fix timeline
along with it; if it is not, you will get the reasoning rather than silence.

## Scope

This repository is a demonstration of a maintenance pattern, not a product with deployed users.
The findings worth reporting are the ones that would matter to somebody adopting the pattern:

- A path by which an automated agent could change infrastructure that policy does not permit it to
  change, or escape the approval gate for changes that require a human.
- Credential exposure — through workflow configuration, the dev container, or committed files.
- Permissions granted to the self-hosted runner fleet that exceed what its work requires,
  particularly anything reachable from untrusted pull request code.
- Workflow triggers that run untrusted code with access to secrets. `pull_request_target` is the
  usual culprit.

## Not in scope

Findings that depend on already having write access to this repository, or on a maintainer
deliberately merging a malicious change. The threat model here assumes the human review gate holds.

## Supported versions

`main` only. This repository is not released or versioned.
