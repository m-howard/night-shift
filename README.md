<h1 align="center">Night Shift</h1>

<p align="center">
  <em>A crew of GitHub Copilot cloud agents that maintains the self-hosted GitHub Actions
  infrastructure they run on.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-6.0-blue?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Bun-1.3-black?style=flat-square&logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/Node-24-339933?style=flat-square&logo=nodedotjs" alt="Node">
  <img src="https://img.shields.io/badge/Pulumi-3.256-purple?style=flat-square&logo=pulumi" alt="Pulumi">
  <img src="https://img.shields.io/badge/AWS-orange?style=flat-square&logo=amazon-aws" alt="AWS">
  <img src="https://img.shields.io/badge/Vitest-4.1-6E9F18?style=flat-square&logo=vitest" alt="Vitest">
  <img src="https://img.shields.io/badge/ESLint-10-4B32C3?style=flat-square&logo=eslint" alt="ESLint">
</p>

## ✨ What this is

Platform teams are asked to do more with fewer hands, but the maintenance never stops: version
bumps, bug fixes, security findings, and a steady stream of vendor releases.

Night Shift is a working demonstration of the second shift. Agents clock in overnight against this
repository's own infrastructure — they update dependencies, read release notes and vendor blogs,
open pull requests, classify each operational change by risk, and auto-deploy the changes policy
already approves. Everything else escalates to a human in the morning.

The point of the pattern is the boundary: what agents can safely own, what stays gated, and how a
human keeps control of everything that matters.

## 🚀 Quick start

The repository ships a dev container with Node, Bun, the Pulumi CLI, the AWS CLI and `gh` already
pinned to the versions this repo declares. Open it in VS Code and reopen in container, then:

```bash
bun install         # post-create already runs this
bun run test        # unit suite — no credentials, no network
bun run lint
bun run typecheck
```

For infrastructure work, state lives in the local file backend:

```bash
cp .env.example .env    # set AWS_REGION and PULUMI_CONFIG_PASSPHRASE
pulumi login --local
```

## 🏗️ Architecture

> **Status:** the runner infrastructure is not written yet. This repository currently carries the
> toolchain, conventions and policy scaffolding the stack will be built inside.

The Pulumi stack under `src/` will describe the self-hosted Actions runner fleet on AWS —
the same fleet the night shift's own jobs execute on, which is what makes the demonstration honest.

## 📁 Project structure

```text
.devcontainer/       # Pinned toolchain — versions are read from .nvmrc, .bun-version, package.json
.github/workflows/   # GitHub Actions pipelines
src/                 # The Pulumi stack — AWS runner infrastructure (planned)
└── components/      # Reusable Pulumi components
tests/
├── unit/            # No credentials, no network — the default `bun run test`
├── integration/     # Runs against live AWS; fails loudly when unconfigured
└── helpers/         # Test helpers
scripts/             # Repository tooling
```

## 💻 Scripts

| Command                    | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `bun run test`             | Unit suite. Safe to run anywhere.                          |
| `bun run test:watch`       | Unit suite in watch mode.                                  |
| `bun run test:coverage`    | Unit suite with V8 coverage.                               |
| `bun run test:integration` | Live-AWS suite. Requires real credentials — see below.     |
| `bun run typecheck`        | `tsc --noEmit` over `src`, `tests` and `scripts`.          |
| `bun run lint`             | ESLint, type-aware.                                        |
| `bun run lint:md`          | markdownlint.                                              |
| `bun run format`           | Prettier, writing in place.                                |
| `bun run clean`            | Removes build output; `--all` also removes `node_modules`. |

### Testing against live infrastructure

`bun run test:integration` talks to a real AWS account and is deliberately **not** part of
`bun run test`. Missing configuration fails the run and names the variable rather than skipping —
a suite that reports green having tested nothing is the one failure mode an auto-deploy pipeline
cannot afford.

## 📖 Documentation

| Document                                             | Description                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| [Developer Quickstart](docs/user_docs/quickstart.md) | Run a first job on the managed runners with working CI and agent examples |
| [End-User Docs](docs/user_docs/README.md)            | End-user guidance for labels, builds, networking, troubleshooting, and requests |
| [Operator Docs](docs/operator_docs/README.md)        | Deployment, debugging, validation, and maintenance runbooks for operators |

## 📖 Conventions

[AGENTS.md](AGENTS.md) records the conventions this repository enforces, for humans and agents
alike. `eslint.config.mjs` encodes most of them; the ones a linter cannot check live in that file.

## 📄 License

MIT

---

<p align="center">
  <em>Good night. The shift starts at midnight. 🌙</em>
</p>
